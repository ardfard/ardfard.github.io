---
title: Exploring Hashicorp Vault
---

HashiCorp Vault is a secure and scalable tool for managing sensitive information like API keys, tokens, and database credentials. It centralizes storage, enforces fine-grained access control, provides audit logging, and ensures encryption, addressing the challenges of dynamic, distributed environments.

Key features include its dynamic secrets engine, which generates short-lived credentials for databases, cloud providers, and APIs, reducing the risk of leaks or misuse. Administrators can define fine-grained access policies based on roles or application needs, enforcing the principle of least privilege.

Vault’s API-driven architecture integrates seamlessly with various programming languages and frameworks. Features like secret versioning, key rotation, and encryption as a service help teams build secure applications that follow industry best practices.

# Development setup

## Installation

The Vault is available in a client-server configuration. 
### Server setup

Below is the command to start the server using Docker:
```bash
$ docker run --cap-add=IPC_LOCK -e 'VAULT_DEV_ROOT_TOKEN_ID=myroot' -e 'VAULT_DEV_LISTEN_ADDRESS=0.0.0.0:8200' -p 8200:8200 --name my-vault vault
```

Now the server is availble to connect to in localhost using port 8200.

## Client setup

### Using Command-Line

Follow this guide to install the client cli program. 

export environment variable for the Vault address.
```bash
$ export VAULT_ADDR='http://0.0.0.0:8200' 
```

export environment variable for the Vault token 
```bash
$ export VAULT_TOKEN='myroot'
```

check the connection 
```bash
$ vault status
```

If the connection is successful it should show output similar to picture below 

![Vault status](../images/vault-status.png){width=500px}

### From Go

Install Vault go client 
```bash
$ go get github.com/hashicorp/vault/api
```

Code example to interact with Vault using the Go client 
```go
package main

import (
	"fmt"
	"log"
	"os"

	vault "github.com/hashicorp/vault/api"
)

func main() {
	vaultAddress := os.Getenv("VAULT_ADDR")
	vaultToken := os.Getenv("VAULT_TOKEN")

	// Initialize Vault client
	client, err := createVaultClient(vaultAddress, vaultToken)
	if err != nil {
		log.Fatal(err)
	}

	// Write secret to Vault
	err = writeSecret(client, "secret/myapp", "password", "mypassword123")
	if err != nil {
		log.Fatal(err)
	}
	fmt.Println("Secret written successfully")

	// Read secret from Vault
	secretValue, err := readSecret(client, "secret/myapp", "password")
	if err != nil {
		log.Fatal(err)
	}
	fmt.Printf("Secret value: %s\n", secretValue)
}

func createVaultClient(address, token string) (*vault.Client, error) {
	config := &vault.Config{
		Address: address,
	}

	client, err := vault.NewClient(config)
	if err != nil {
		return nil, fmt.Errorf("failed to create Vault client: %w", err)
	}

	client.SetToken(token)

	return client, nil
}

func writeSecret(client *vault.Client, path, key, value string) error {
	data := map[string]interface{}{
		key: value,
	}

	_, err := client.Logical().Write(path, data)
	if err != nil {
		return fmt.Errorf("failed to write secret: %w", err)
	}

	return nil
}

func readSecret(client *vault.Client, path, key string) (string, error) {
	secret, err := client.Logical().Read(path)
	if err != nil {
		return "", fmt.Errorf("failed to read secret: %w", err)
	}

	if secret == nil || secret.Data == nil {
		return "", fmt.Errorf("no secret found at path: %s", path)
	}

	value, ok := secret.Data[key].(string)
	if !ok {
		return "", fmt.Errorf("secret key not found: %s", key)
	}

	return value, nil

    }
```


## Cheat Sheet

### Putting a key-value inside a mount 
```bash
$ vault kv put -mount=secret foo bar=b
```

Getting a value based on key 
```bash
vault kv get -mount=secret foo
```

## References

Sample application of using Vault from within a Go apps: [https://github.com/hashicorp/hello-vault-go/tree/main/sample-app](https://github.com/hashicorp/hello-vault-go/tree/main/sample-app)