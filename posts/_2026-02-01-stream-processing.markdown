---
title: Composable stream processing
description: Composable stream processing
tags: stream, processing, composable
author: ardfard
---

Stream processing means you handle data as it arrives, one element or chunk at a time, instead of loading the whole dataset into memory first. Batch processing does the opposite. You read a file into a list, transform it, and write it back out.

Composable stream processing is about gluing small pieces into a pipeline. A reader, a parser, a filter, a database writer. Each piece stays independent, so you can rearrange them without rewriting the whole thing.

### Constant memory

The practical reason people reach for streams is memory. Say you have a 100GB log file and you want to count error lines.

Load the whole file with `f.read()` or `readFile` and you will OOM unless you have an absurd amount of RAM.

Stream it instead. Read a line, check if it is an error, bump a counter, drop the line. At any moment you hold almost nothing. Memory stays roughly constant relative to input size, $O(1)$. A 1MB file, a 100GB file, and an infinite socket look the same to your allocator.

### Case study: nightly access log scan

We ran a nightly job over gzipped nginx access logs in S3. About 40GB uncompressed per day, split across a few hundred objects. All it needed to do was count 5xx responses per route and write the worst offenders into Postgres for the on-call dashboard.

The first version downloaded each object, gunzipped it to disk, loaded every line into a list, then aggregated. On a busy day the worker needed 16GB of RAM and still swapped. A corrupt file halfway through killed the whole night's run.

The streaming rewrite was smaller and duller, which is what you want:

```python
from collections import Counter
from smart_open import open

def iter_log_lines(uris):
    """Source: yield lines from each gzipped S3 object."""
    for uri in uris:
        # smart_open streams the object and decompresses on the fly
        with open(uri, 'r') as stream:
            for line in stream:
                yield line

def parse_route_and_status(lines):
    """Transformer: pull route and status code out of each line."""
    for line in lines:
        # Assume space-separated access log: ... "GET /api/foo HTTP/1.1" 500 ...
        parts = line.split()
        route = parts[6]
        status = int(parts[8])
        yield route, status

def count_5xx(pairs):
    """Sink: fold into a Counter. Only routes with errors stay in memory."""
    counts = Counter()
    for route, status in pairs:
        if status >= 500:
            counts[route] += 1
    return counts

uris = [
    's3://prod-logs/nginx/2026-02-01/app-01.log.gz',
    's3://prod-logs/nginx/2026-02-01/app-02.log.gz',
]

# Compose the pipeline. Nothing runs until count_5xx pulls.
error_counts = count_5xx(parse_route_and_status(iter_log_lines(uris)))
write_to_postgres(error_counts.most_common(20))
```

Peak memory fell to a few hundred MB. The `Counter` grows with distinct error routes, not with log size. Each S3 object sits in its own `with` block, so a bad file fails alone instead of taking the whole night with it.

Composability paid off more than cleverness. For local debugging we swapped the S3 URI list for a directory of files. Same parser, same fold, same Postgres sink.

### Haskell: conduit

Haskell's `conduit` and `pipes` libraries make this composition explicit, and they clean up resources like file handles deterministically. I like conduit for the pipe operator and how ResourceT handles cleanup.

Here is a pipeline that generates numbers, doubles them, keeps values above 10, and prints:

```haskell
import Data.Conduit
import qualified Data.Conduit.List as CL
import Control.Monad.Trans.Resource (runResourceT)
import Control.Monad.IO.Class (liftIO)

main :: IO ()
main = runResourceT $ runConduit $
    -- Source: Generate numbers 1 to 20
    CL.sourceList [1..20]
    -- Conduit: Multiply each by 2
    .| CL.map (* 2)
    -- Conduit: Keep only numbers > 10
    .| CL.filter (> 10)
    -- Sink: Print the results
    .| CL.mapM_ (liftIO . print)
```

`.|` connects independent pieces. Swap `CL.sourceList` for `sourceFile` and the rest of the pipeline stays the same.

The [conduit repo](https://github.com/snoyberg/conduit) has solid tutorials if you want more.

### Python: generators

Python does the same thing with generators and `yield`. Data is produced lazily:

```python
def number_generator(n):
    """Source: Yield numbers from 0 to n-1"""
    for i in range(n):
        yield i

def double_processor(stream):
    """Transformer: Multiply items by 2"""
    for item in stream:
        yield item * 2

def filter_large(stream, threshold):
    """Transformer: Filter items greater than threshold"""
    for item in stream:
        if item > threshold:
            yield item

# Constructing the pipeline
# No data is processed yet, we are just defining the flow
source = number_generator(20)
doubled = double_processor(source)
filtered = filter_large(doubled, 10)

# The actual processing happens here, element by element
for item in filtered:
    print(item)
```

`doubled` and `filtered` are generator objects. Nothing runs until the `for` loop asks for the next item. The pull propagates up the chain:

1. `filtered` asks `doubled` for a value.
2. `doubled` asks `source` for a value.
3. `source` yields something like 6.
4. `doubled` yields 12.
5. `filtered` keeps 12 because it is greater than 10.
6. `print` gets 12.

You never hold the full list.

### Closing resources in Python

Bare generators have a sharp edge. If the consumer breaks early or raises, the generator pauses and cleanup like `f.close()` may not run. That is nondeterministic cleanup, and it is how you leak file handles in production.

Haskell's `ResourceT` solves this. In Python, reach for a context manager:

```python
import contextlib

def source_from_file(path):
    """
    Naive generator: Might leak file handle if iteration stops early
    or if an exception is raised during processing.
    """
    f = open(path, 'r')
    for line in f:
        yield int(line)
    # This close() might never be reached!
    f.close()

@contextlib.contextmanager
def robust_file_source(path):
    """
    Robust source: Guarantees file is closed using 'with' block
    """
    f = open(path, 'r')
    try:
        yield (int(line) for line in f)
    finally:
        print("Closing file handle...")
        f.close()

# Usage
# The 'with' block ensures the file is closed when we exit the block,
# whether we finish normally, stop early, or hit an exception.
with robust_file_source('data.txt') as stream:
    doubled = double_processor(stream)
    for item in doubled:
        print(item)
        # Even if we break here, 'finally' block above runs.
        if item > 100:
            break
```

The `with` block runs `finally` whether you finish, break, or throw.

For S3, GCS, and Azure, [smart_open](https://github.com/piskvorky/smart_open) handles connections, retries, and buffering behind a normal `open` API.

```python
from smart_open import open

# Streams efficiently from S3, handles errors and cleanup
with open('s3://my-bucket/large-log.txt', 'r') as stream:
    for line in stream:
        process(line)
```

### toolz and aiostream

Native generators are enough for a lot of jobs. When the pipeline gets longer, `toolz` and `aiostream` save typing.

#### toolz

[Toolz](https://github.com/pytoolz/toolz) gives you functional helpers that work on iterators, so they stay lazy by default:

```python
from toolz import pipe
from toolz.curried import map, filter, take

# Define our data
data = range(100)

# Build a pipeline using pipe
# 1. Start with data
# 2. Multiply by 2
# 3. Filter > 10
# 4. Take the first 5 results
result = pipe(
    data,
    map(lambda x: x * 2),
    filter(lambda x: x > 10),
    take(5),
    list  # Consume the iterator
)

print(result) # [12, 14, 16, 18, 20]
```

#### aiostream

[aiostream](https://aiostream.readthedocs.io/) is for async streams. Use it when the bottleneck is I/O, like hitting several APIs at once:

```python
import asyncio
from aiostream import stream, pipe

async def main():
    # Create an async stream
    xs = stream.range(10)

    # Compose operations
    ys = (xs
          | pipe.map(lambda x: x * 2)
          | pipe.filter(lambda x: x > 5)
          | pipe.take(3))

    # Run the stream
    async with ys.stream() as streamer:
        async for item in streamer:
            print(item)

# asyncio.run(main())
```

Build pipelines from small, reusable pieces. Process one element at a time so memory stays flat. Use conduit when you want typed, deterministic cleanup in Haskell. Use generators when you want something small in Python. Reach for toolz or aiostream when the pipeline or the I/O gets messy. Same idea in every case.
