---
title: Inject Your Dependencies with Guice
---


This year I am trying to learn about Scala, because I think it is the most plausible way for me to land an FP job. So I am go straight to most popular framework for web development, that is Play framework, just in case there's a job opening related to it.

Here I am encounter a snippet that I don't understand  when I need to integrate authentication to my Play apps.

```scala
@Singleton
class HomeController @Inject() (
  userAction: UserInfoAction,
    cc: ControllerComponents
) extends AbstractController(cc) {

  def index = userAction { implicit request: UserRequest[_] =>
    Ok(views.html.index(form))
  }

}
```

Here I am very curious about the `@Inject` annotation. This turn out comes from the Guece dependency injection framework. So in short, like all thing in java world, Play use dependency injection to customize it's behaviour.

## Dependency Injection


This technique is well known in OOP world. This is the D in SOLID principle. It means rather than you encode your dependency in your class/module, you instead give it as argument for your object creation. More thorough (and also more correct) explanation can be read [here](https://github.com/google/guice/wiki/Motivation). 

In short dependency injection via dependency inversion solves problem where we need environment in our computation context. The same problem that can be solved by Reader Monad pattern in Functional programming world (but that's discussion for another time).

## Guice

Guice is a lightweight dependency injection framework developed by Google. It enables you to write loosely coupled code by managing dependencies and their lifecycles for you.

Here are some highlights of Guice:

- **Annotation-based configuration:** You can use annotations like `@Inject` to inject dependencies, reducing boilerplate code.
- **Modules for configuration:** You define modules to bind interfaces to their implementations.
- **Integration with Play Framework:** Guice integrates seamlessly with Play, making it easy to use dependency injection in your applications.

### A Simple Guice Example

Here’s a basic example to demonstrate Guice:

```scala
import com.google.inject.{Guice, Inject, Module, AbstractModule}

// Service interface and implementation
trait GreetingService {
  def greet(name: String): String
}

class GreetingServiceImpl extends GreetingService {
  override def greet(name: String): String = s"Hello, $name!"
}

// Consumer class
class Greeter @Inject() (greetingService: GreetingService) {
  def sayHello(name: String): Unit = {
    println(greetingService.greet(name))
  }
}

// Guice module for binding
class AppModule extends AbstractModule {
  override def configure(): Unit = {
    bind(classOf[GreetingService]).to(classOf[GreetingServiceImpl])
  }
}

// Application entry point
object GuiceExampleApp extends App {
  val injector = Guice.createInjector(new AppModule)
  val greeter = injector.getInstance(classOf[Greeter])
  greeter.sayHello("Scala Developer")
}
```

### Applying Guice to My Problem

To apply Guice to the authentication problem in the Play Framework, let’s break it down:

1. **Define the Dependencies:** Identify the components your controller depends on. In the provided snippet, `UserInfoAction` and `ControllerComponents` are such dependencies.

2. **Use `@Inject` to Inject Dependencies:** Use the `@Inject` annotation to declare dependencies in your class constructor.

3. **Configure Guice Bindings:** If your dependency has multiple implementations or needs specific configuration, define a Guice module to bind the interface to its implementation.

Here’s how you might define `UserInfoAction`:

```scala
import javax.inject.Inject
import play.api.mvc._

class UserInfoAction @Inject() (parser: BodyParsers.Default) extends ActionBuilder[UserRequest, AnyContent] {
  override protected def executionContext: ExecutionContext = scala.concurrent.ExecutionContext.global

  override def invokeBlock[A](request: Request[A], block: UserRequest[A] => Future[Result]): Future[Result] = {
    val userRequest = new UserRequest(user = "TestUser", request = request)
    block(userRequest)
  }
}

class UserRequest[A](val user: String, request: Request[A]) extends WrappedRequest[A](request)
```

And configure it in your module:

```scala
import com.google.inject.AbstractModule

class AppModule extends AbstractModule {
  override def configure(): Unit = {
    bind(classOf[UserInfoAction]).asEagerSingleton()
  }
}
```

This setup ensures that Guice handles the creation and injection of `UserInfoAction`, making your `HomeController` clean and focused on its responsibilities.

## Conclusion

Dependency Injection simplifies managing dependencies in large applications. Guice, as used in the Play Framework, makes it easy to adopt this pattern. While the learning curve might seem steep initially, the benefits in terms of code maintainability and testability are well worth the effort.

Happy coding in Scala! 🚀
