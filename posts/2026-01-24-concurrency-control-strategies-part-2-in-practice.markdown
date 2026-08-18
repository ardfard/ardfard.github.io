---
title: "Concurrency Control Strategies"
date: "2026-01-24"
tags: "locks, synchronization, concurrency"
author: ardfard
---

To build high performance system, a concurrent programming is inevitable. However, concurrent programming is a complex topic, and one of the most challenging problems is how to safely and efficiently access shared resources. We will explore different techniques to do concurrent programming while still maintaining correctness and data consistency.

When dealing with concurrent access to shared resources, there are several concurrency control strategies to consider. The two most fundamental approaches are **pessimistic locking** and **optimistic locking**, though other important techniques exist as well. These strategies are not mutually exclusive—in practice, many systems combine multiple techniques to achieve optimal performance and correctness. Each approach differs fundamentally in how it handles potential conflicts between concurrent operations.

### Pessimistic Locking

Pessimistic locking assumes that conflicts between transactions are likely, so it locks resources early to prevent conflicts. Think of a scenario where a payment gateway is processing a transaction: when a customer initiates a payment, the system immediately locks their account balance to prevent double-spending, holds that lock while verifying funds and processing the payment, and only releases it after the transaction completes or fails. This is a pessimistic approach because it assumes that conflicts are likely to happen and its better to be safe than sorry.


**Rust implementation with PostgreSQL:**

```rust
use tokio_postgres::{Client, Error};

#[derive(Debug)]
struct Account {
    id: i32,
    balance: i64,
}

#[derive(Debug)]
enum PaymentError {
    InsufficientFunds,
    DatabaseError(Error),
}

impl From<Error> for PaymentError {
    fn from(err: Error) -> Self {
        PaymentError::DatabaseError(err)
    }
}

async fn process_payment(
    client: &mut Client,
    account_id: i32,
    amount: i64,
) -> Result<(), PaymentError> {
    // Start transaction
    let transaction = client.transaction().await?;
    
    // Lock the account row and get current balance
    let row = transaction
        .query_one(
            "SELECT id, balance FROM accounts WHERE id = $1 FOR UPDATE",
            &[&account_id],
        )
        .await?;
    
    let account = Account {
        id: row.get(0),
        balance: row.get(1),
    };
    
    // Verify sufficient funds
    if account.balance < amount {
        // Transaction automatically rolls back when dropped
        return Err(PaymentError::InsufficientFunds);
    }
    
    // Deduct the amount (lock is still held)
    transaction
        .execute(
            "UPDATE accounts SET balance = balance - $1 WHERE id = $2",
            &[&amount, &account_id],
        )
        .await?;
    
    // Commit transaction and release lock
    transaction.commit().await?;
    
    println!("Payment of {} processed for account {}", amount, account_id);
    Ok(())
}

// Usage example
async fn example() -> Result<(), Error> {
    let (client, connection) = tokio_postgres::connect(
        "host=localhost user=postgres dbname=payments",
        tokio_postgres::NoTls,
    )
    .await?;
    
    // Spawn connection in background
    tokio::spawn(async move {
        if let Err(e) = connection.await {
            eprintln!("connection error: {}", e);
        }
    });
    
    let mut client = client;
    
    // Process payment - pessimistic lock ensures no double-spending
    match process_payment(&mut client, 123, 100).await {
        Ok(_) => println!("Payment successful"),
        Err(PaymentError::InsufficientFunds) => {
            println!("Payment failed: insufficient funds")
        }
        Err(PaymentError::DatabaseError(e)) => {
            eprintln!("Payment failed: database error: {}", e)
        }
    }
    
    Ok(())
}
```

In this example:
- The `FOR UPDATE` clause acquires an exclusive row-level lock when selecting
- The lock is held throughout the transaction
- Other transactions trying to lock the same account will wait
- The lock is automatically released when the transaction commits or rolls back
- This prevents race conditions where two concurrent payments could exceed the account balance

Pessimistic locking prevents concurrent modifications by blocking other transactions, guaranteeing consistency at the cost of reduced concurrency. While this approach can lead to deadlocks if not managed carefully, it performs better when conflicts are frequent. This makes it ideal for scenarios like bank transactions where balance updates are common, inventory systems with low stock items, ticket booking systems, and any situation where conflicts are expected rather than exceptional.


### Optimistic Locking

Optimistic locking assumes that conflicts are rare, so it doesn't lock resources. Instead, it detects conflicts at commit time.  The approach works by reading data along with a version number or timestamp, then performing modifications without holding any locks. Before committing changes, the system checks whether the version has changed since it was read. If the version is unchanged, the transaction commits and increments the version number; if it has changed, indicating another transaction modified the data, the transaction rolls back and can be retried.


Think of a scenario where a shopping cart is being updated: when a customer adds an item to their cart, the system reads the cart and its version number, then updates the cart without holding any locks. Before committing changes, the system checks whether the version has changed since it was read. If the version is unchanged, the transaction commits and increments the version number; if it has changed, indicating another transaction modified the data, the transaction rolls back and can be retried.

**Rust implementation with PostgreSQL:**

```rust
use tokio_postgres::{Client, Error};
use std::time::Duration;
use tokio::time::sleep;

#[derive(Debug)]
struct Cart {
    id: i32,
    user_id: i32,
    items: i32,
    version: i32,
}

#[derive(Debug)]
enum OptimisticLockError {
    MaxRetriesExceeded,
    DatabaseError(Error),
}

impl From<Error> for OptimisticLockError {
    fn from(err: Error) -> Self {
        OptimisticLockError::DatabaseError(err)
    }
}

async fn add_item_to_cart(
    client: &Client,
    cart_id: i32,
    items_to_add: i32,
    max_retries: u32,
) -> Result<(), OptimisticLockError> {
    for attempt in 0..max_retries {
        // Read cart with current version (no locks held)
        let row = client
            .query_one(
                "SELECT id, user_id, items, version FROM carts WHERE id = $1",
                &[&cart_id],
            )
            .await?;
        
        let cart = Cart {
            id: row.get(0),
            user_id: row.get(1),
            items: row.get(2),
            version: row.get(3),
        };
        
        let new_items = cart.items + items_to_add;
        let new_version = cart.version + 1;
        
        // Try to update with version check
        // This will only succeed if version hasn't changed
        let result = client
            .execute(
                "UPDATE carts SET items = $1, version = $2 
                 WHERE id = $3 AND version = $4",
                &[&new_items, &new_version, &cart_id, &cart.version],
            )
            .await?;
        
        if result > 0 {
            // Success! Version matched and update completed
            println!(
                "Successfully added {} items to cart {} (attempt {})",
                items_to_add, cart_id, attempt + 1
            );
            return Ok(());
        }
        
        // Version mismatch - someone else modified the cart
        println!(
            "Version mismatch on cart {}, retrying... (attempt {})",
            cart_id, attempt + 1
        );
        
        // Exponential backoff before retry
        if attempt < max_retries - 1 {
            let backoff_ms = 100 * 2_u64.pow(attempt);
            sleep(Duration::from_millis(backoff_ms)).await;
        }
    }
    
    Err(OptimisticLockError::MaxRetriesExceeded)
}

// Usage example
async fn example() -> Result<(), Error> {
    let (client, connection) = tokio_postgres::connect(
        "host=localhost user=postgres dbname=shop",
        tokio_postgres::NoTls,
    )
    .await?;
    
    tokio::spawn(async move {
        if let Err(e) = connection.await {
            eprintln!("connection error: {}", e);
        }
    });
    
    // Create table with version column
    client
        .execute(
            "CREATE TABLE IF NOT EXISTS carts (
                id SERIAL PRIMARY KEY,
                user_id INT NOT NULL,
                items INT DEFAULT 0,
                version INT DEFAULT 0
            )",
            &[],
        )
        .await?;
    
    // Simulate concurrent updates
    let cart_id = 1;
    
    // Spawn multiple tasks trying to update the same cart
    let handles: Vec<_> = (0..3)
        .map(|i| {
            let client = client.clone();
            tokio::spawn(async move {
                match add_item_to_cart(&client, cart_id, 1, 5).await {
                    Ok(_) => println!("Task {} succeeded", i),
                    Err(OptimisticLockError::MaxRetriesExceeded) => {
                        println!("Task {} failed: max retries exceeded", i)
                    }
                    Err(OptimisticLockError::DatabaseError(e)) => {
                        eprintln!("Task {} failed: database error: {}", i, e)
                    }
                }
            })
        })
        .collect();
    
    // Wait for all tasks to complete
    for handle in handles {
        handle.await.unwrap();
    }
    
    Ok(())
}
```

In this optimistic locking example:
- No locks are acquired during the read operation
- Multiple transactions can read the same cart simultaneously
- The `version` column tracks changes to the cart
- Updates only succeed if the version matches (using `WHERE version = $4`)
- If the version changed, the update affects 0 rows, triggering a retry
- Exponential backoff prevents overwhelming the database with retries
- This allows high concurrency while preventing lost updates

Optimistic locking excels in scenarios where conflicts are rare, allowing high concurrency since no locks are held during the transaction. This approach eliminates the risk of deadlocks entirely, though it may require retries when conflicts do occur. The strategy performs best when the probability of concurrent modifications is low, making it ideal for read-heavy workloads where multiple users are unlikely to modify the same data simultaneously.

Common use cases include user profile updates, where each user typically only modifies their own profile; configuration management systems, where changes are infrequent; content management systems with many readers but few concurrent editors; and distributed caching systems where cache invalidation conflicts are uncommon. In these scenarios, the overhead of occasional retries is far outweighed by the benefits of allowing unrestricted concurrent access.

### Comparison: Optimistic vs Pessimistic

| Aspect | Optimistic Locking | Pessimistic Locking |
|--------|-------------------|---------------------|
| **Philosophy** | Conflicts are rare | Conflicts are likely |
| **Locking** | No lock during transaction | Lock acquired early |
| **Concurrency** | High (allows parallel reads/writes) | Low (blocks other transactions) |
| **Performance** | Better with rare conflicts | Better with frequent conflicts |
| **Conflicts** | Detected at commit time | Prevented by blocking |
| **Retries** | May need multiple retries | No retries needed |
| **Deadlocks** | Cannot occur | Can occur |
| **Database Load** | Lower (no lock management) | Higher (lock management overhead) |
| **Complexity** | Requires retry logic | Simpler application logic |
| **Failure Mode** | Transaction rollback + retry | Waiting/timeout |

### Choosing the Right Strategy

The choice between optimistic and pessimistic locking depends on your specific use case and workload characteristics. Optimistic locking works best when read operations vastly outnumber writes (typically 90% or more reads), and when multiple users rarely modify the same data simultaneously. This approach shines when you need high throughput and low latency, particularly in distributed systems where deadlocks are a concern. The ability to allow concurrent access without blocking makes it ideal for scenarios where conflicts are the exception rather than the rule.

Conversely, pessimistic locking is the better choice when write conflicts are common and the cost of retries would be prohibitively high. If you need guaranteed immediate consistency or are dealing with long-running operations that would be expensive to retry, pessimistic locking provides the certainty you need. This approach is particularly valuable when strong serialization is required, as it prevents conflicts before they occur rather than detecting them after the fact.

In practice, many systems don't strictly adhere to one strategy but instead use a hybrid approach that combines both techniques based on the specific requirements of each operation. For example, a money transfer system might use pessimistic locking for critical financial data to ensure absolute consistency, while employing optimistic locking for less critical operations like updating audit logs. This allows the system to balance the need for data integrity with the desire for high performance.

**Rust Hybrid Approach Example:**

```rust
use tokio_postgres::{Client, Error, Transaction};
use std::time::Duration;

#[derive(Debug)]
struct Account {
    id: i32,
    balance: i64,
}

#[derive(Debug)]
struct AuditLog {
    id: i32,
    version: i32,
}

#[derive(Debug)]
enum TransferError {
    InsufficientFunds,
    AuditLogConflict,
    DatabaseError(Error),
}

impl From<Error> for TransferError {
    fn from(err: Error) -> Self {
        TransferError::DatabaseError(err)
    }
}

async fn transfer_money_hybrid(
    client: &mut Client,
    from_account_id: i32,
    to_account_id: i32,
    amount: i64,
) -> Result<(), TransferError> {
    // Start transaction
    let transaction = client.transaction().await?;
    
    // PESSIMISTIC LOCKING for critical financial data
    // Lock both accounts to prevent concurrent modifications
    let from_row = transaction
        .query_one(
            "SELECT id, balance FROM accounts WHERE id = $1 FOR UPDATE",
            &[&from_account_id],
        )
        .await?;
    
    let to_row = transaction
        .query_one(
            "SELECT id, balance FROM accounts WHERE id = $1 FOR UPDATE",
            &[&to_account_id],
        )
        .await?;
    
    let from_account = Account {
        id: from_row.get(0),
        balance: from_row.get(1),
    };
    
    let to_account = Account {
        id: to_row.get(0),
        balance: to_row.get(1),
    };
    
    // Verify sufficient funds
    if from_account.balance < amount {
        // Transaction automatically rolls back when dropped
        return Err(TransferError::InsufficientFunds);
    }
    
    // Perform the transfer (locks still held)
    transaction
        .execute(
            "UPDATE accounts SET balance = balance - $1 WHERE id = $2",
            &[&amount, &from_account_id],
        )
        .await?;
    
    transaction
        .execute(
            "UPDATE accounts SET balance = balance + $1 WHERE id = $2",
            &[&amount, &to_account_id],
        )
        .await?;
    
    // OPTIMISTIC LOCKING for audit log (less critical)
    // Try to update audit log with version check, retry if needed
    let max_retries = 3;
    for attempt in 0..max_retries {
        // Read audit log version (no lock)
        let audit_row = transaction
            .query_one(
                "SELECT id, version FROM audit_logs WHERE id = 1",
                &[],
            )
            .await?;
        
        let audit_log = AuditLog {
            id: audit_row.get(0),
            version: audit_row.get(1),
        };
        
        // Insert audit entry
        transaction
            .execute(
                "INSERT INTO audit_entries (log_id, from_account, to_account, amount, timestamp)
                 VALUES ($1, $2, $3, $4, NOW())",
                &[&audit_log.id, &from_account_id, &to_account_id, &amount],
            )
            .await?;
        
        // Try to update version (optimistic check)
        let result = transaction
            .execute(
                "UPDATE audit_logs SET version = $1 WHERE id = $2 AND version = $3",
                &[&(audit_log.version + 1), &audit_log.id, &audit_log.version],
            )
            .await?;
        
        if result > 0 {
            // Version matched - success!
            break;
        }
        
        if attempt == max_retries - 1 {
            // Max retries exceeded for audit log
            // But we still commit the transfer since it's non-critical
            println!("Warning: Audit log update failed after retries, but transfer succeeded");
            break;
        }
        
        // Version mismatch - retry
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    
    // Commit transaction (releases all pessimistic locks)
    transaction.commit().await?;
    
    println!(
        "Transfer successful: ${} from account {} to account {}",
        amount, from_account_id, to_account_id
    );
    
    Ok(())
}

// Setup and usage example
async fn setup_hybrid_example() -> Result<(), Error> {
    let (mut client, connection) = tokio_postgres::connect(
        "host=localhost user=postgres dbname=banking",
        tokio_postgres::NoTls,
    )
    .await?;
    
    tokio::spawn(async move {
        if let Err(e) = connection.await {
            eprintln!("connection error: {}", e);
        }
    });
    
    // Create tables
    client
        .batch_execute(
            "
            CREATE TABLE IF NOT EXISTS accounts (
                id SERIAL PRIMARY KEY,
                balance BIGINT NOT NULL
            );
            
            CREATE TABLE IF NOT EXISTS audit_logs (
                id SERIAL PRIMARY KEY,
                version INT DEFAULT 0
            );
            
            CREATE TABLE IF NOT EXISTS audit_entries (
                id SERIAL PRIMARY KEY,
                log_id INT REFERENCES audit_logs(id),
                from_account INT,
                to_account INT,
                amount BIGINT,
                timestamp TIMESTAMP
            );
            
            INSERT INTO accounts (id, balance) VALUES (1, 1000), (2, 500)
                ON CONFLICT (id) DO NOTHING;
            INSERT INTO audit_logs (id, version) VALUES (1, 0)
                ON CONFLICT (id) DO NOTHING;
            ",
        )
        .await?;
    
    // Perform transfer using hybrid approach
    match transfer_money_hybrid(&mut client, 1, 2, 100).await {
        Ok(_) => println!("Transfer completed successfully"),
        Err(TransferError::InsufficientFunds) => {
            println!("Transfer failed: insufficient funds")
        }
        Err(TransferError::AuditLogConflict) => {
            println!("Transfer succeeded but audit log had conflicts")
        }
        Err(TransferError::DatabaseError(e)) => {
            eprintln!("Transfer failed: database error: {}", e)
        }
    }
    
    Ok(())
}
```

**Why This Hybrid Approach Works:**

The hybrid approach applies pessimistic locking to critical financial data by using `FOR UPDATE` to lock account rows, preventing race conditions in balance updates and guaranteeing no double-spending or lost updates. These locks block other transactions until commit, ensuring absolute consistency for the most sensitive operations. Meanwhile, optimistic locking handles the audit log without acquiring any locks, relying instead on version-based conflict detection. This allows high concurrency for logging operations, and even if the audit update fails due to a version conflict, the transfer itself still succeeds since retries are cheap for logging operations.

This hybrid strategy delivers strong consistency where it matters most—protecting critical financial data with absolute guarantees—while maintaining high performance for less critical operations like logging. By not locking everything, the system reduces contention and achieves better overall throughput. The pattern proves particularly valuable in financial systems, e-commerce platforms, and applications where certain data like accounts and inventory require strict protection, while auxiliary data such as logs, analytics, and caching can tolerate more flexible consistency models.


## Concurrency Control Techniques In Practice

Beyond the two pillars of optimistic and pessimistic locking, there are several other important techniques, usually employed by the databases themselves:

### Two-Phase Locking (2PL)

A protocol used in database systems to ensure serializability.

**How it works:**
- **Growing Phase**: Transaction acquires locks but cannot release any
- **Shrinking Phase**: Transaction releases locks but cannot acquire new ones

**Variants:**
- **Strict 2PL**: Holds all locks until commit (most common in databases)
- **Rigorous 2PL**: Holds all locks until transaction ends
- **Conservative 2PL**: Acquires all locks at once before execution

**Example:**
```sql
-- Database implicitly uses 2PL
BEGIN TRANSACTION
  SELECT * FROM orders WHERE id = 1 FOR UPDATE;     -- Acquire lock
  SELECT * FROM inventory WHERE id = 100 FOR UPDATE; -- Acquire lock
  -- Growing phase complete
  UPDATE orders SET status = 'processed';
  UPDATE inventory SET quantity = quantity - 1;
  -- Locks held until commit
COMMIT  -- Shrinking phase - all locks released
```

**Advantages:**
- Guarantees serializability
- Used by most relational databases
- Well-understood and proven

**Disadvantages:**
- Can cause deadlocks
- Lower concurrency than some alternatives

#### 2. Multi-Version Concurrency Control (MVCC)

Maintains multiple versions of data to allow readers and writers to not block each other.

**How it works:**
- Each write creates a new version of the data
- Readers see a consistent snapshot of data at a point in time
- Writers don't block readers, readers don't block writers
- Old versions are garbage collected when no longer needed

**Example (PostgreSQL style):**
```sql
-- Transaction 1 (Reader)
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ;
SELECT * FROM products WHERE id = 1;  -- Sees version at transaction start

-- Transaction 2 (Writer) - runs concurrently
BEGIN TRANSACTION;
UPDATE products SET price = 20 WHERE id = 1;  -- Creates new version
COMMIT;

-- Back to Transaction 1
SELECT * FROM products WHERE id = 1;  -- Still sees old version (consistent snapshot)
COMMIT;
```

Timeline Visualization of MVCC:

Time  Transaction 1 (Reader)              Transaction 2 (Writer)           Database State
─────────────────────────────────────────────────────────────────────────────────────────
T0                                                                         product_id=1
                                                                           price=10
                                                                           version=v1
T1    BEGIN (snapshot at T1)
      ├─ Sees v1                                                          
      │
T2    SELECT * FROM products                                              price=10 (v1)
      WHERE id = 1;
      ├─ Returns: price=10
      │
T3                                        BEGIN
                                          │
T4                                        UPDATE products                  price=20 (v2)
                                          SET price = 20                   price=10 (v1) ← still exists
                                          WHERE id = 1;
                                          │
T5                                        COMMIT                           price=20 (v2) ← current
                                          └─ Creates v2                    price=10 (v1) ← old but visible to T1
      │
T6    SELECT * FROM products
      WHERE id = 1;
      ├─ Still returns: price=10 ◄──────────────────────────────────────► Transaction 1 still sees v1
      │  (consistent snapshot!)                                             (snapshot isolation)
      │
T7    COMMIT
      └─ Snapshot ends

T8    New transaction would see v2 ────────────────────────────────────► price=20 (v2)
      (price=20)

Key Concepts:
┌─────────────────────────────────────────────────────────────────┐
│ • Transaction 1 gets a "snapshot" of the database at T1         │
│ • Transaction 2's changes create a NEW version (v2)             │
│ • OLD version (v1) is kept for Transaction 1                    │
│ • Transaction 1 always sees v1 (consistent read)                │
│ • No locks needed - readers don't block writers!                │
│ • After both commit, v1 can be garbage collected                │
└─────────────────────────────────────────────────────────────────┘
```


**Advantages:**
- High concurrency - readers never block writers
- No read locks needed
- Better performance for read-heavy workloads
- Consistent snapshots for transactions

**Disadvantages:**
- More storage overhead (multiple versions)
- Garbage collection complexity
- Write-write conflicts still need resolution

**Used by:** PostgreSQL, MySQL InnoDB, Oracle, SQL Server


### Snapshot Isolation

A variant of MVCC where each transaction sees a consistent snapshot.

**How it works:**
- Transaction reads data as of its start time
- Writes are buffered
- At commit, check for write-write conflicts with concurrent transactions
- Commit succeeds if no conflicts

**Example:**
```sql
-- PostgreSQL SERIALIZABLE uses snapshot isolation
BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE;
  SELECT * FROM inventory WHERE product_id = 1;  -- Snapshot at T1
  -- Another transaction updates same row and commits
  UPDATE inventory SET quantity = quantity - 1 WHERE product_id = 1;
  -- Commit fails if write-write conflict detected
COMMIT;  -- May throw serialization error
```

**Advantages:**
- High concurrency for readers
- No read locks
- Predictable read behavior

**Disadvantages:**
- Write skew anomalies possible (unless using full serializability)
- Requires conflict detection at commit
- May need application retries

### Advisory Locks

Advisory locks are application-level locks that require cooperation between processes. Unlike regular locks that are enforced by the database or operating system, advisory locks only work if all applications agree to check and respect them.

**Key Concept:**
- **Advisory** = "Please respect this lock" (voluntary)
- **Mandatory** = "You cannot access this" (enforced)

Most database row locks are mandatory, but many databases (PostgreSQL, MySQL) also provide advisory lock functions for application-specific coordination.

**How they work:**
1. Application requests an advisory lock using a numeric ID
2. Database grants or denies the lock (first-come, first-served)
3. Other applications can check if the lock exists
4. **But**: Nothing prevents them from ignoring it and proceeding anyway
5. Lock is released explicitly or when connection closes

**PostgreSQL Advisory Locks:**

```sql
-- Session 1: Acquire advisory lock with ID 12345
SELECT pg_advisory_lock(12345);
-- Lock acquired, this blocks until available

-- Session 2: Try to acquire same lock
SELECT pg_advisory_lock(12345);
-- This will WAIT until Session 1 releases it

-- Session 1: Release the lock
SELECT pg_advisory_unlock(12345);

-- Non-blocking variant
SELECT pg_try_advisory_lock(12345);
-- Returns true if acquired, false if already locked
```

**Rust Implementation with PostgreSQL:**

```rust
use tokio_postgres::{Client, Error};

async fn process_job_with_advisory_lock(
    client: &Client,
    job_id: i64,
) -> Result<bool, Error> {
    // Try to acquire advisory lock (non-blocking)
    let acquired = client
        .query_one("SELECT pg_try_advisory_lock($1)", &[&job_id])
        .await?
        .get::<_, bool>(0);
    
    if !acquired {
        println!("Job {} is already being processed by another worker", job_id);
        return Ok(false);
    }
    
    println!("Lock acquired for job {}", job_id);
    
    // Process the job (critical section)
    // Only this worker can process this job ID right now
    process_job(job_id).await?;
    
    // Release the advisory lock
    client
        .execute("SELECT pg_advisory_unlock($1)", &[&job_id])
        .await?;
    
    println!("Lock released for job {}", job_id);
    Ok(true)
}

async fn process_job(job_id: i64) -> Result<(), Error> {
    // Simulate job processing
    println!("Processing job {}...", job_id);
    tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;
    Ok(())
}

// Example: Multiple workers competing for jobs
async fn worker_example() -> Result<(), Error> {
    let (client, connection) = tokio_postgres::connect(
        "host=localhost user=postgres dbname=jobs",
        tokio_postgres::NoTls,
    )
    .await?;
    
    tokio::spawn(async move {
        if let Err(e) = connection.await {
            eprintln!("connection error: {}", e);
        }
    });
    
    // Spawn multiple workers trying to process the same job
    let job_id = 42;
    let handles: Vec<_> = (0..3)
        .map(|worker_id| {
            let client = client.clone();
            tokio::spawn(async move {
                match process_job_with_advisory_lock(&client, job_id).await {
                    Ok(true) => println!("Worker {} processed the job", worker_id),
                    Ok(false) => println!("Worker {} skipped (already locked)", worker_id),
                    Err(e) => eprintln!("Worker {} error: {}", worker_id, e),
                }
            })
        })
        .collect();
    
    for handle in handles {
        handle.await.unwrap();
    }
    
    Ok(())
}
```

**Use Cases for Advisory Locks:**

1. **Distributed Job Processing:**
   - Multiple workers pulling from a job queue
   - Advisory lock ensures only one worker processes each job
   - Example: Background job systems like Sidekiq, Celery

```rust
// Worker picks job from queue
async fn pick_job(client: &Client) -> Result<Option<Job>, Error> {
    let jobs = client.query("SELECT id FROM jobs WHERE status = 'pending'", &[]).await?;
    
    for row in jobs {
        let job_id: i64 = row.get(0);
        
        // Try to lock this job
        let locked: bool = client
            .query_one("SELECT pg_try_advisory_lock($1)", &[&job_id])
            .await?
            .get(0);
        
        if locked {
            return Ok(Some(fetch_job(client, job_id).await?));
        }
        // If not locked, try next job
    }
    
    Ok(None) // No available jobs
}
```

2. **Preventing Duplicate Cron Jobs:**
   - Multiple servers running same cron schedule
   - Advisory lock ensures only one runs at a time

```rust
async fn run_daily_report(client: &Client) -> Result<(), Error> {
    let lock_id = 999; // Unique ID for this cron job
    
    let acquired: bool = client
        .query_one("SELECT pg_try_advisory_lock($1)", &[&lock_id])
        .await?
        .get(0);
    
    if !acquired {
        println!("Report already running on another server");
        return Ok(());
    }
    
    // Generate report (only one server does this)
    generate_report().await?;
    
    client.execute("SELECT pg_advisory_unlock($1)", &[&lock_id]).await?;
    Ok(())
}
```

3. **Rate Limiting / Resource Pools:**
   - Limit concurrent access to external API
   - Use multiple advisory locks (one per "slot")

4. **Application-Level Mutexes:**
   - Coordinate between different application instances
   - Without needing a separate coordination service

**Advantages:**
- Lightweight - no table rows needed
- Session-scoped - automatic cleanup on disconnect
- Integer-based - easy to coordinate across applications
- Fast - no table scans or row locks
- Useful for distributed coordination

**Disadvantages:**
- **Not enforced** - applications can ignore them
- Database-specific (PostgreSQL, MySQL have different APIs)
- Requires all apps to cooperate
- No built-in timeout (blocking version waits forever)
- Doesn't protect actual data - just coordinates applications

**Advisory vs Mandatory Locks:**

| Aspect | Advisory Lock | Mandatory Lock (e.g., FOR UPDATE) |
|--------|--------------|-----------------------------------|
| **Enforcement** | Voluntary (cooperation required) | Enforced by database |
| **Scope** | Application coordination | Data protection |
| **Storage** | In-memory (lock manager) | Tied to table rows |
| **Can be ignored?** | Yes | No |
| **Use case** | Job coordination, cron deduplication | Data consistency |

**When to use Advisory Locks:**
- Coordinating multiple application instances
- Preventing duplicate background jobs
- Rate limiting across processes
- When you control all applications accessing the database
- When you need lightweight coordination without data locks

**When NOT to use:**
- Don't rely on them for data integrity (use row locks instead)
- Don't use if untrusted applications access your database
- Don't use when you need guaranteed enforcement

## Understanding the Categories

Before comparing techniques, it's important to understand that these concepts operate at different levels and serve different purposes:

### Database Concurrency Control Strategies

These are strategies for coordinating access to **persistent data** (databases):

| Strategy | Lock-Free | Deadlock Risk | Complexity | Best For |
|----------|-----------|---------------|------------|----------|
| **Pessimistic Locking** | No | Yes | Low | High contention, critical data |
| **Optimistic Locking** | Yes | No | Medium | Low contention, read-heavy |
| **2PL (Two-Phase Locking)** | No | Yes | Low | Traditional RDBMS implementation |
| **MVCC** | Mostly | No | Medium | Read-heavy workloads, modern RDBMS |
| **Timestamp Ordering** | Yes | No | Medium | Distributed systems |
| **Snapshot Isolation** | Mostly | No | Medium | Mixed workloads (variant of MVCC) |

### Application-Level Concurrency (In-Memory)

These are techniques for coordinating **shared memory** within a single process:

| Technique | Lock-Free | Deadlock Risk | Complexity | Best For |
|-----------|-----------|---------------|------------|----------|
| **Lock-Free Programming** | Yes | No | High | Counters, low-latency requirements |
| **STM** | Yes | No | Medium | Complex in-memory transactions |
| **Mutex/Semaphore** | No | Yes | Low | Simple thread synchronization |

### Key Differences:

**Database Strategies (Pessimistic, Optimistic, MVCC, etc.):**
- Coordinate access to **persistent storage** (database)
- Work across **different processes/servers**
- Handle **transactions** that span multiple operations
- Survive process restarts
- Used with SQL databases (PostgreSQL, MySQL, etc.)

**In-Memory Techniques (Lock-Free, STM, Mutex, etc.):**
- Coordinate access to **shared memory** 
- Work within a **single process** (between threads)
- Typically for **single operations** or small critical sections
- Lost when process restarts
- Used in application code (Rust, C++, Java, etc.)

### Can You Use Both?

Yes! A typical application might use:
- **MVCC** (database strategy) - For coordinating database access between users
- **Lock-Free counters** (in-memory) - For tracking metrics in your application
- **Optimistic locking** (database) - For shopping cart updates
- **Mutex** (in-memory) - For protecting in-memory caches

**Example:**
```rust
// In-memory: Lock-free counter for metrics
static REQUEST_COUNT: AtomicU64 = AtomicU64::new(0);

async fn handle_request(client: &Client, user_id: i32) {
    // In-memory: Increment request counter (lock-free)
    REQUEST_COUNT.fetch_add(1, Ordering::Relaxed);
    
    // Database: Update user profile (optimistic locking)
    let user = client.query_one(
        "SELECT id, name, version FROM users WHERE id = $1",
        &[&user_id]
    ).await?;
    
    let version: i32 = user.get(2);
    
    client.execute(
        "UPDATE users SET last_seen = NOW(), version = $1 
         WHERE id = $2 AND version = $3",
        &[&(version + 1), &user_id, &version]
    ).await?;
}
```

This clarifies that these techniques solve different problems at different layers of your application.


## Conclusion

Understanding different locking strategies is crucial for building high-performance concurrent systems:

- Use **optimistic locking** for high-concurrency, read-heavy workloads where conflicts are rare
- Use **pessimistic locking** when conflicts are frequent and consistency is critical
- Choose the appropriate **lock type** (mutex, read-write, semaphore) based on your access patterns
- Consider **hybrid approaches** for complex systems
- Always measure and profile - the "best" strategy depends on your specific workload

The key is to understand your system's characteristics: read/write ratio, conflict frequency, and consistency requirements.