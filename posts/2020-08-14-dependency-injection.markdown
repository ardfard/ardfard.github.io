---
title: Inject Your Dependencies with Guece
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

In short dependency injection via dependency inversion solves problem where we need environment in our computation context. The same problem that can be solved by Reader Monad pattern in Functional programming world (but that discussion for another time).

## Guece
Guece is framework by google 


* Guece example

* How apply it to my problem
