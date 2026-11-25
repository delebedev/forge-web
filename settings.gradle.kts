pluginManagement {
    repositories {
        gradlePluginPortal()
        mavenCentral()
    }
}

rootProject.name = "forge-web"
include("server")
include("card-presentation")
include("browser-engine")

// gradle/libs.versions.toml is the default `libs` catalog. Only browser-engine and
// card-presentation build against the Leyline modules below.
includeBuild("leyline") {
    dependencySubstitution {
        substitute(module("leyline:domain")).using(project(":domain"))
        substitute(module("leyline:engine")).using(project(":engine"))
        substitute(module("leyline:gre-proto")).using(project(":gre-proto"))
    }
}
