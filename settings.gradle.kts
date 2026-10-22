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

dependencyResolutionManagement {
    versionCatalogs {
        create("libs") {
            from(files("leyline/gradle/libs.versions.toml"))
            // Product runtime patches do not require an engine catalog release.
            version("logback", "1.6.5")
            version("netty", "4.2.17.Final")
        }
    }
}

includeBuild("leyline") {
    dependencySubstitution {
        substitute(module("leyline:domain")).using(project(":domain"))
        substitute(module("leyline:engine")).using(project(":engine"))
        substitute(module("leyline:gre-proto")).using(project(":gre-proto"))
    }
}
