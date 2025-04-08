# Kubernetes Operator Simple Showcase

## Introduction

This post is just a simple exploratory post to record my learning process of building a Kubernetes operator.
We will build a simple Kubernetes operator using operator-sdk and go.

## Prerequisites

- Go
- Kubernetes cluster (e.g. minikube, KinD, or real cluster)
- kubectl
- Operator-sdk cli
- kubebuilder (for generating Kubernetes APIs)

## Create a new operator project

```bash
operator-sdk init --domain=ngublag.com --repo=github.com/ardfard/k8s-operator-showcase
```

This will scaffold Go project for the operator.

## Define a Custom Resource Definition (CRD)

Now, create an API for our custom resource App:

```bash
operator-sdk create api --group apps --version v1alpha1 --kind App --resource --controller
```
This command generates:

*    A CRD definition (api/v1alpha1/app_types.go)
*    A controller (controllers/app_controller.go)

4. Define the CRD Schema

Edit `api/v1alpha1/app_types.go` to define the spec and status of our App resource:

```go
package v1alpha1

import (
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// AppSpec defines the desired state
type AppSpec struct {
	Replicas int32 `json:"replicas"`
	Image    string `json:"image"`
}

// AppStatus defines the observed state
type AppStatus struct {
	AvailableReplicas int32 `json:"availableReplicas"`
}

//+kubebuilder:object:root=true
//+kubebuilder:subresource:status

type App struct {
	metav1.TypeMeta   `json:",inline"`
	metav1.ObjectMeta `json:"metadata,omitempty"`

	Spec   AppSpec   `json:"spec,omitempty"`
	Status AppStatus `json:"status,omitempty"`
}

//+kubebuilder:object:root=true

type AppList struct {
	metav1.TypeMeta `json:",inline"`
	metav1.ListMeta `json:"metadata,omitempty"`
	Items           []App `json:"items"`
}

func init() {
	SchemeBuilder.Register(&App{}, &AppList{})
}
```

This defines an App resource with:

*    A spec field containing replicas and image.
*    A status field tracking availableReplicas.
*    Init function to register the App resource with the SchemeBuilder.

Generate the CRD YAML:

```bash
make generate && make manifests
```

## Implement the Controller Logic

Edit controllers/app_controller.go to manage the App resource. The controller will ensure that a corresponding Deployment exists.

Replace the Reconcile function with:
```go
func (r *AppReconciler) Reconcile(ctx context.Context, req ctrl.Request) (ctrl.Result, error) {

	var app appsv1alpha1.App
	if err := r.Get(ctx, req.NamespacedName, &app); err != nil {
		return ctrl.Result{}, client.IgnoreNotFound(err)
	}


	// Define deployment for the app
	deployment := &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{
			Name:      app.Name,
			Namespace: app.Namespace,
		},
		Spec: appsv1.DeploymentSpec{
			Replicas: &app.Spec.Replicas,
			Selector: &metav1.LabelSelector{
				MatchLabels: map[string]string{"app": app.Name},
			},
			Template: corev1.PodTemplateSpec{
				ObjectMeta: metav1.ObjectMeta{Labels: map[string]string{"app": app.Name}},
				Spec: corev1.PodSpec{
					Containers: []corev1.Container{
						{
							Name:  "app",
							Image: app.Spec.Image,
						},
					},
				},
			},
		},	
	}

	// Create or update the deployment
	if err := r.Client.Create(ctx, deployment); err != nil {
		return ctrl.Result{}, err
	}

	// Update the status of the app
	app.Status.AvailableReplicas = deployment.Status.AvailableReplicas
	
	if err := r.Client.Status().Update(ctx, &app); err != nil {
		return ctrl.Result{}, err
	}

	return ctrl.Result{}, nil
}
```

## Deploy the Operator

### Build and Push the Operator Image

```bash
make docker-build IMG=example.com/app-operator:v1
make docker-push IMG=example.com/app-operator:v1
```

### Deploy to Kubernetes

```bash
make deploy IMG=example.com/app-operator:v1
```

This installs the CRD and the Operator into the cluster.

## Create a Custom Resource

Define an App instance in `app-sample.yaml`:

```yaml
apiVersion: apps.example.com/v1alpha1
kind: App
metadata:
  name: my-app
spec:
  replicas: 3
  image: nginx:latest
```

Apply it:

```bash
kubectl apply -f app-sample.yaml
```

Check the created Deployment:

```bash
kubectl get deployments
```

## Verify the Operator

List the running pods:

```bash
kubectl get pods
```

Check the App resource:

```bash
kubectl get app my-app -o yaml
```

You should see the status.availableReplicas field reflecting the deployment state.

## Clean Up the Operator

```bash
make undeploy
```

## Conclusion

This post demonstrated how to build a simple Kubernetes operator using operator-sdk and go. You can find the complete code in [this repository](https://github.com/ardfard/k8s-operator-showcase).



