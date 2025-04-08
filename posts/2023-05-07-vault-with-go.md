---
title: "Secure Database Access with HashiCorp Vault in a Golang Application"
---

# Introduction

HashiCorp Vault is a popular secrets management tool that helps developers and administrators securely store, access, and manage sensitive information such as API keys, tokens, and database credentials. In this article, we will walk through the process of integrating HashiCorp Vault with a Golang application to securely access a database.


![Accessing Database From Go Apps Using Vault Provided Credentials](../images/golang vault arch.svg){width=600px}


# Integration

Create a new Go project and import the necessary packages.

```go
package main

import (
    "database/sql"
    "fmt"
    "log"
    "os"

    _ "github.com/lib/pq"
    vault "github.com/hashicorp/vault/api"
)
```

Initialize a Vault client.

```go
func initVaultClient() (*vault.Client, error) {
    config := &vault.Config{
        Address: os.Getenv("VAULT_ADDR"),
    }

    client, err := vault.NewClient(config)
    if err != nil {
        return nil, fmt.Errorf("failed to create vault client: %v", err)
    }

    client.SetToken(os.Getenv("VAULT_TOKEN"))

    return client, nil
}
```

Create a function to fetch PostgreSQL credentials from Vault.

```go
func getPostgresCredentials(client *vault.Client) (username, password string, err error) {
    secret, err := client.Logical().Read("database/creds/readonly")
    if err != nil {
        return "", "", fmt.Errorf("failed to read database credentials: %v", err)
    }

    username = secret.Data["username"].(string)
    password = secret.Data["password"].(string)

    return username, password, nil
}
```

Set up a function to establish a database connection.

```go
func connectToDatabase(client *vault.Client) (*sql.DB, error) {
    username, password, err := getPostgresCredentials(client)
    if err != nil {
        return nil, err
    }

    connStr := fmt.Sprintf("postgres://%s:%s@localhost:5432/postgres?sslmode=disable", username, password)
    db, err := sql.Open("postgres", connStr)
    if err != nil {
        return nil, fmt.Errorf("failed to connect to the database: %v", err)
    }

    return db, nil
}
```

Create a main function to execute the application.

```go
func main() {
    vaultClient, err := initVaultClient()
    if err != nil {
        log.Fatalf("Error initializing Vault client: %v", err)
    }

    db, err := connectToDatabase(vaultClient)
    if err != nil {
        log.Fatalf("Error connecting to the database: %v", err)
    }
    defer db.Close()

    // Add your application logic here, using the `db` object to interact with the database.
}
```

This Golang application demonstrates how to securely access a PostgreSQL database using HashiCorp Vault. The code initializes a Vault client, fetches the PostgreSQL credentials from Vault, and establishes a database connection using the fetched credentials. You can now build your application logic using the db object to interact with the database.

# Closing 

In conclusion, HashiCorp Vault provides a robust and secure solution for managing database access credentials in modern applications. By leveraging Vault's dynamic secrets engine, developers can greatly reduce the risk of unauthorized access to sensitive data, minimize the potential for human error, and enhance the overall security posture of their applications. Integrating Vault with a Golang application, as demonstrated in this article, not only simplifies the process of fetching and using database credentials but also promotes best practices in secure application development. 

However, it is important to note that the code presented above does not handle credential leasing renewal when the credential is close to its TTL expiration. This is a crucial aspect of maintaining secure and continuous access to your database resources. To learn more about implementing credential renewal in your application, refer to this comprehensive sample code.

With Vault in your arsenal, you can confidently build and deploy applications that prioritize the security and privacy of your users' data.
