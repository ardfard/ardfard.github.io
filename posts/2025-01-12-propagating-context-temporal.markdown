---
title: Propagating context in Temporal
---
In my current project, a Go service uses a request ID to identify requests and propagate it throughout the system. 
Middlewares intercept incoming requests, generate a unique ID, and pass it to the next step via context. 
The logging middleware extracts the request ID from the context and adds it to the log context in the logger. 
We also utilize Temporal to manage long-running tasks—tasks that consist of several steps that can be interrupted and resumed. 
It is beneficial to use the same request ID for logging and tracing within the Temporal workflow. 
However, how do we propagate the request ID to the Temporal workflow? This is where the context propagation feature in Temporal comes into play.

## Generating and Propagating Request ID

Below is a code snippet that demonstrates how to generate a request ID and propagate it to subsequent steps via context:

```go
func RequestIDMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		requestId := c.GetHeader("X-Request-ID")
		if requestId == "" {
			id, _ := uuid.NewUUID()
			requestId = id.String()
		}

		// Insert context to http request
		ctx := context.WithValue(c.Request.Context(), "request-id-context", requestId)
		c.Request = c.Request.WithContext(ctx)

		// Set the id to ensure that the request-id is in the response
		c.Header("X-Request-ID", requestId)

		c.Next()
	}
}
``` 

All request handlers wrapped with this middleware will have a request ID in their context. 
Now, let’s explore how to propagate this request ID to the Temporal workflow. 
First, we need to define a context propagator that will extract the request ID from the context and add it to the Temporal workflow context.

## Defining a Context Propagator

```go
// requestKey is the key used by the go context
const requestKey = "request-id-context"

// propagationKey is the key used by the propagator to pass values through the
// Temporal server headers
const propagationKey = "request-id-context"

// NewContextPropagator returns a context propagator that propagates a set of
// string key-value pairs across a workflow
func NewContextPropagator() workflow.ContextPropagator {
	return &propagator{}
}

// Inject injects values from context into headers for propagation
func (s *propagator) Inject(ctx context.Context, writer workflow.HeaderWriter) error {
	value := ctx.Value(requestKey)
	payload, err := converter.GetDefaultDataConverter().ToPayload(value)
	if err != nil {
		return err
	}
	writer.Set(propagationKey, payload)
	return nil
}

// InjectFromWorkflow injects values from context into headers for propagation
func (s *propagator) InjectFromWorkflow(ctx workflow.Context, writer workflow.HeaderWriter) error {
	value := ctx.Value(requestKey)
	payload, err := converter.GetDefaultDataConverter().ToPayload(value)
	if err != nil {
		return err
	}
	writer.Set(propagationKey, payload)
	return nil
}

// Extract extracts values from headers and puts them into context
func (s *propagator) Extract(ctx context.Context, reader workflow.HeaderReader) (context.Context, error) {
	if value, ok := reader.Get(propagationKey); ok {
		var requestID string
		if err := converter.GetDefaultDataConverter().FromPayload(value, &requestID); err != nil {
			return ctx, nil
		}
		ctx = NewContext(ctx, requestID)
	}

	return ctx, nil
}

// ExtractToWorkflow extracts values from headers and puts them into context
func (s *propagator) ExtractToWorkflow(ctx workflow.Context, reader workflow.HeaderReader) (workflow.Context, error) {
	if value, ok := reader.Get(propagationKey); ok {
		var requestID string
		if err := converter.GetDefaultDataConverter().FromPayload(value, &requestID); err != nil {
			return ctx, nil
		}
		ctx = workflow.WithValue(ctx, requestKey, requestID)
	}

	return ctx, nil
}
```

## Registering the Propagator

Next, we need to register the propagator with the Temporal client and workflow:

```go
client := client.NewClient(client.Options{
    HostPort: temporalHostPort,
	ContextPropagators: []workflow.ContextPropagator{NewContextPropagator()},
})
```
## Using Request ID in Temporal Workflows
Now you can access the request ID within your Temporal workflows and activities:

```go
func MyWorkflow(ctx workflow.Context) error {
	requestID := workflow.GetContext(ctx, requestKey)
	fmt.Println("Request ID:", requestID)
	return nil
}
```

By following these steps, you can effectively propagate a request ID through your system using Temporal workflows in Go. This approach enhances traceability and logging consistency across your application.
