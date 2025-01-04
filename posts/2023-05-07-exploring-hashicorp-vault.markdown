---
title: Exploring Hashicorp Vault
---


HashiCorp Vault is an essential tool for developers, DevOps engineers, and security professionals seeking a secure and scalable solution to manage sensitive information. It centralizes the storage, access, and management of secrets like API keys, tokens, and database credentials while providing fine-grained access control, audit logging, and encryption capabilities. Vault is designed to address the challenges of managing secrets in a dynamic, distributed environment where applications and infrastructure components need to communicate securely.

One of the key features of Vault is its dynamic secrets engine, which allows for the automatic generation of short-lived credentials for various services, including databases, cloud providers, and other third-party APIs. This approach significantly reduces the risk of credentials being leaked or misused, as each instance of an application or service receives a unique set of credentials with a limited lifespan. Additionally, Vault enforces the principle of least privilege by allowing administrators to define fine-grained policies that control access to secrets based on roles or specific application requirements.

Moreover, Vault's API-driven architecture enables seamless integration with a wide range of programming languages and frameworks, making it a versatile solution for developers working in diverse technology stacks. With built-in support for features like secret versioning, key rotation, and data encryption as a service, Vault empowers teams to build and maintain secure applications that adhere to industry best practices.

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

If the connection is successful it should show output similar to below 

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