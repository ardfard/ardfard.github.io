---
title: "Understanding Locks"
date: "2026-01-24"
tags: "locks, synchronization, concurrency"
author: ardfard
---

## Understanding Locks



### Lock-Free Programming

Uses atomic operations instead of locks to coordinate between threads.

**Techniques:**
- **Compare-And-Swap (CAS)**: Atomic operation that updates a value only if it matches expected value
- **Load-Link/Store-Conditional (LL/SC)**: Similar to CAS but for larger data structures
- **Atomic operations**: Increment, decrement, exchange, etc.

**Example:**
```rust
use std::sync::Arc;
use std::sync::atomic::{AtomicI64, Ordering};
use std::thread;

struct LockFreeCounter {
    value: AtomicI64,
}

impl LockFreeCounter {
    fn new() -> Self {
        Self {
            value: AtomicI64::new(0),
        }
    }
    
    // Simple atomic increment
    fn increment(&self) -> i64 {
        self.value.fetch_add(1, Ordering::SeqCst)
    }
    
    // More complex: conditional update using compare-and-swap
    fn increment_if_below(&self, max: i64) -> Result<i64, i64> {
        loop {
            let current = self.value.load(Ordering::SeqCst);
            
            if current >= max {
                return Err(current); // Already at max
            }
            
            let new_value = current + 1;
            
            // Atomic compare-and-swap: only update if value is still 'current'
            match self.value.compare_exchange(
                current,
                new_value,
                Ordering::SeqCst,
                Ordering::SeqCst,
            ) {
                Ok(_) => return Ok(new_value), // Success
                Err(_) => continue, // Someone else changed it, retry
            }
        }
    }
    
    fn get(&self) -> i64 {
        self.value.load(Ordering::SeqCst)
    }
}

fn main() {
    let counter = Arc::new(LockFreeCounter::new());
    let mut handles = vec![];
    
    // Spawn 10 threads all incrementing the same counter
    for i in 0..10 {
        let counter = Arc::clone(&counter);
        let handle = thread::spawn(move || {
            for _ in 0..1000 {
                counter.increment();
            }
            println!("Thread {} finished", i);
        });
        handles.push(handle);
    }
    
    // Wait for all threads
    for handle in handles {
        handle.join().unwrap();
    }
    
    println!("Final count: {}", counter.get()); // Should be 10,000
    
    // Test conditional increment
    let counter2 = LockFreeCounter::new();
    match counter2.increment_if_below(5) {
        Ok(v) => println!("Incremented to {}", v),
        Err(v) => println!("Already at max, current: {}", v),
    }
}
```

**Advantages:**
- No deadlocks possible
- Better scalability in high-contention scenarios
- Lower latency (no context switches)
- Progress guaranteed (at least one thread makes progress)

**Disadvantages:**
- Complex to implement correctly
- Limited to simple data structures
- ABA problem (value changes from A to B back to A)
- Harder to reason about

### Software Transactional Memory (STM)

Treats memory operations like database transactions with ACID properties.

**How it works:**
- Mark beginning of transaction
- Read/write to shared memory
- Commit atomically or rollback on conflicts
- System automatically handles conflicts

**Example (Clojure/Haskell style):**
```haskell
-- Haskell STM example
transfer :: TVar Int -> TVar Int -> Int -> STM ()
transfer from to amount = do
    fromBalance <- readTVar from
    when (fromBalance < amount) $ error "Insufficient funds"
    writeTVar from (fromBalance - amount)
    toBalance <- readTVar to
    writeTVar to (toBalance + amount)

-- Usage
main = atomically $ transfer account1 account2 100
```

**Advantages:**
- Composable transactions
- No explicit locking
- Automatic conflict resolution
- Easier to reason about than manual locking

**Disadvantages:**
- Performance overhead
- Not widely supported in mainstream languages
- Can have hidden retries
- Limited to in-memory operations

### Timestamp Ordering

Each transaction is assigned a timestamp, and operations are ordered by timestamp.

**How it works:**
- Transaction gets timestamp at start
- Read/write operations check timestamps
- If operation violates timestamp order, transaction aborts

**Example:**
```rust
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};

#[derive(Debug)]
struct AbortTransaction(String);

struct TimestampOrdering {
    data: HashMap<String, String>,
    read_ts: HashMap<String, u64>,   // Latest read timestamp
    write_ts: HashMap<String, u64>,  // Latest write timestamp
    counter: AtomicU64,
}

impl TimestampOrdering {
    fn new() -> Self {
        Self {
            data: HashMap::new(),
            read_ts: HashMap::new(),
            write_ts: HashMap::new(),
            counter: AtomicU64::new(0),
        }
    }
    
    fn begin_transaction(&self) -> u64 {
        self.counter.fetch_add(1, Ordering::SeqCst)
    }
    
    fn read(&mut self, ts: u64, key: &str) -> Result<Option<String>, AbortTransaction> {
        let write_timestamp = self.write_ts.get(key).copied().unwrap_or(0);
        
        if ts < write_timestamp {
            return Err(AbortTransaction("Reading too old value".to_string()));
        }
        
        let current_read_ts = self.read_ts.get(key).copied().unwrap_or(0);
        self.read_ts.insert(key.to_string(), current_read_ts.max(ts));
        
        Ok(self.data.get(key).cloned())
    }
    
    fn write(
        &mut self,
        ts: u64,
        key: &str,
        value: String,
    ) -> Result<(), AbortTransaction> {
        let read_timestamp = self.read_ts.get(key).copied().unwrap_or(0);
        let write_timestamp = self.write_ts.get(key).copied().unwrap_or(0);
        
        if ts < read_timestamp {
            return Err(AbortTransaction("Too late to write".to_string()));
        }
        
        if ts < write_timestamp {
            // Ignore write (Thomas Write Rule)
            return Ok(());
        }
        
        self.data.insert(key.to_string(), value);
        self.write_ts.insert(key.to_string(), ts);
        
        Ok(())
    }
}

// Usage example
fn main() {
    let mut ts_system = TimestampOrdering::new();
    
    // Transaction 1
    let ts1 = ts_system.begin_transaction();
    println!("Transaction 1 started with timestamp: {}", ts1);
    
    // Transaction 1 writes
    ts_system.write(ts1, "account_balance", "1000".to_string()).unwrap();
    println!("Transaction 1 wrote: account_balance = 1000");
    
    // Transaction 2 (later timestamp)
    let ts2 = ts_system.begin_transaction();
    println!("Transaction 2 started with timestamp: {}", ts2);
    
    // Transaction 2 reads
    match ts_system.read(ts2, "account_balance") {
        Ok(Some(value)) => println!("Transaction 2 read: account_balance = {}", value),
        Ok(None) => println!("Transaction 2: key not found"),
        Err(e) => println!("Transaction 2 aborted: {:?}", e),
    }
    
    // Transaction 2 tries to write
    match ts_system.write(ts2, "account_balance", "2000".to_string()) {
        Ok(_) => println!("Transaction 2 wrote: account_balance = 2000"),
        Err(e) => println!("Transaction 2 write aborted: {:?}", e),
    }
    
    // Transaction 0 (old timestamp) tries to write - should be rejected
    match ts_system.write(0, "account_balance", "500".to_string()) {
        Ok(_) => println!("Old transaction wrote (unexpected)"),
        Err(e) => println!("Old transaction correctly aborted: {:?}", e),
    }
}
```

**Advantages:**
- No deadlocks
- No waiting (abort immediately if conflict)
- Guarantees serializability

**Disadvantages:**
- High abort rate under contention
- Cascading aborts possible
- Requires accurate clock synchronization in distributed systems

### Mutex (Mutual Exclusion)

Mutex is a lock that is used to synchronize access to a shared resource. It is a binary lock, meaning that only one thread can acquire the lock at a time.

**Characteristics:**
- Exclusive access - only one thread/process at a time
- Binary state: locked or unlocked
- Simple and straightforward

**Example:**
```python
import threading

mutex = threading.Lock()
shared_counter = 0

def increment():
    global shared_counter
    mutex.acquire()
    try:
        shared_counter += 1
    finally:
        mutex.release()
```

### Read-Write Locks (Shared-Exclusive Locks)

Allows multiple readers but exclusive access for writers. This is a form of pessimistic locking that optimizes for read-heavy workloads.

**Characteristics:**
- Multiple readers can hold the lock simultaneously
- Writers require exclusive access
- Better concurrency than pure mutex for read-heavy workloads

**Example:**
```python
import threading

rw_lock = threading.RLock()
data = {}

def read_data(key):
    with rw_lock:  # Shared read
        return data.get(key)

def write_data(key, value):
    with rw_lock:  # Exclusive write
        data[key] = value
```

### Semaphores

A generalization of mutex that allows N threads to access a resource simultaneously.

**Characteristics:**
- Counter-based (can be > 1)
- Useful for rate limiting or resource pools
- Can control access to N identical resources

**Example:**
```python
import threading

# Allow max 3 concurrent connections
connection_pool = threading.Semaphore(3)

def access_database():
    with connection_pool:
        # Only 3 threads can be here at once
        execute_query()
```

### Spinlocks

A lock where the thread repeatedly checks if the lock is available (busy-waiting).

**Characteristics:**
- No context switching (CPU intensive)
- Very fast for short critical sections
- Wastes CPU cycles if lock is held long

**Use case:** Kernel-level operations, very short critical sections

