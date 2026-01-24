-- 
title: "Concurrency Control Strategies: The Philosophies"
date: "2026-01-24"
tags: "locks, synchronization, concurrency"
author: ardfard
---

To build high performance system, concurrent programming is inevitable. However, concurrent programming is a complex topic, and one of the most challenging problems is how to safely and efficiently access shared resources.  When multiple operations try to access and modify the same data simultaneously, we encounter fundamental problems that can corrupt our data or produce incorrect results. The problem includes:
- A race condition occurs when the correctness of a program depends on the timing or interleaving of multiple operations. The outcome "races" based on which operation completes first.
- A deadlock occurs when two or more operations wait for each other to release resources, creating a circular dependency that prevents any of them from proceeding.
- A livelock occurs when operations continuously retry or wait on resources without making progress, effectively freezing the system.
- lost updates occurs when two operations read the same data, modify it independently, and the last write wins, overwriting the other operation's changes.

So, how do we solve these problems? In next posts we will explore different techniques to do concurrent programming while still maintaining correctness and data consistency.

## The Two Fundamental Approaches: Pessimistic and Optimistic Locking

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


## Conclusion

Concurrency control is fundamental to building correct and performant systems that handle multiple operations simultaneously. We have explored the two fundamental approaches to concurrency control: pessimistic locking and optimistic locking. We have also seen how to combine them in a hybrid approach to achieve the best of both worlds. In the next post, we will see some variations subcategory of these strategies in practice, like in databases or application level.
