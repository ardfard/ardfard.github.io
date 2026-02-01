---
title: Composable stream processing
description: Composable stream processing
tags: stream, processing, composable
author: ardfard
---

Stream processing is a paradigm where data is processed element by element (or chunk by chunk) as it becomes available, rather than waiting for the entire dataset to be loaded into memory. This contrasts with traditional batch processing, where you might read a whole file into a list or array, perform operations on it, and then write it out.

When we talk about "composable" stream processing, we refer to the ability to build complex data processing pipelines by glueing together smaller, independent components. One component might read data, another might parse it, a third might filter it, and a fourth might write it to a database.

### Memory Efficiency and Constant Memory

One of the most significant benefits of stream processing is memory efficiency. Imagine you have a 100GB log file and you want to count the number of error messages.

**The Naive Approach:**
If you try to load the entire 100GB file into memory (e.g., `f.read()` in Python or `readFile` in Haskell), your program will likely crash with an Out of Memory (OOM) error unless you have a massive amount of RAM.

**The Streaming Approach:**
With stream processing, you read the file line by line (or chunk by chunk). You read a line, check if it's an error, increment a counter, and then discard the line from memory. At any given point in time, you only hold a tiny fraction of the data in memory.

This property allows your workflow to have **constant memory usage** ($O(1)$ space complexity relative to the input size). Whether the input is 1MB, 100GB, or an infinite stream from a network socket, your memory footprint remains roughly the same.

### Haskell Example: Conduit

Haskell has excellent libraries for streaming, such as `conduit` and `pipes`. These libraries provide a safe and composable way to handle streams, ensuring resources (like file handles) are cleaned up deterministically.

Here is an example using the `conduit` library. We will create a pipeline that generates numbers, multiplies them by 2, filters those greater than 10, and prints them.

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

The `.|` operator connects these components. Each piece is independent and reusable. If we wanted to process a file instead of a list, we would just swap `CL.sourceList` with a file source like `sourceFile`.

For a deeper dive into Conduit, the [official GitHub repository](https://github.com/snoyberg/conduit) offers excellent tutorials and documentation.

### Python Example: Generators

Python supports stream processing natively through **generators** and the `yield` keyword. Generators allow you to iterate over data lazily.

Here is the equivalent pipeline in Python:

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

In this Python example, `doubled` and `filtered` are generator objects. They don't compute their contents immediately. Instead, when the `for` loop requests the next item, the request propagates up the chain:
1. `filtered` asks `doubled` for a value.
2. `doubled` asks `source` for a value.
3. `source` yields a value (e.g., 6).
4. `doubled` processes it (12) and yields it.
5. `filtered` checks it (12 > 10) and yields it.
6. `print` receives 12.

This lazy evaluation ensures that we never need to hold the entire list of numbers in memory.

### Robust Resource Handling in Python

Simple generators like the one above have a potential flaw: if the consumer stops iterating early (or crashes), the generator is paused and cleanup code (like closing a file) might not run immediately. This is non-deterministic cleanup.

To ensure deterministic resource cleanup (similar to `ResourceT` in Haskell), Python uses **Context Managers** (`with` statement).

Here is a robust pattern using the `contextlib` library to ensure resources are closed even if errors occur:

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

For real-world applications handling streams from cloud storage (S3, GCS, Azure), the library **[smart_open](https://github.com/piskvorky/smart_open)** is an excellent example of robust stream handling. It manages network connections, retries, and buffering while exposing a simple Pythonic API.

```python
from smart_open import open

# Streams efficiently from S3, handles errors and cleanup
with open('s3://my-bucket/large-log.txt', 'r') as stream:
    for line in stream:
        process(line)
```

### Advanced Streaming Libraries

While native generators are powerful, libraries like `toolz` and `aiostream` offer higher-level abstractions for functional and asynchronous stream processing.

#### Functional Streams with Toolz

[Toolz](https://github.com/pytoolz/toolz) provides a suite of functional utilities that are designed to work with iterators, making them memory efficient by default. It allows you to compose complex data pipelines cleanly.

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

#### Async Streams with aiostream

[aiostream](https://aiostream.readthedocs.io/) is designed for asynchronous stream processing, which is crucial when dealing with I/O-bound tasks like fetching data from multiple APIs concurrently.

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

### Conclusion

Composable stream processing is a powerful technique for writing robust, memory-efficient data pipelines. By breaking down complex tasks into small, reusable components, code becomes easier to understand and test. Whether you are using Haskell's `conduit` for type-safe resource management or Python's generators for simplicity, the core concept remains the same: process data as it flows, keep memory usage constant, and compose simple parts into complex systems.