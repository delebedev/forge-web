pluginManagement {
    repositories {
        gradlePluginPortal()
        mavenCentral()
    }
}

// The project name sets the jar name in the browser release classpath.
rootProject.name = "browser-engine"

// gradle/libs.versions.toml is the default `libs` catalog.
includeBuild("../leyline") {
    dependencySubstitution {
        substitute(module("leyline:domain")).using(project(":domain"))
        substitute(module("leyline:engine")).using(project(":engine"))
        substitute(module("leyline:gre-proto")).using(project(":gre-proto"))
    }
}
