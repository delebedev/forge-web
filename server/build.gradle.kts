plugins {
    alias(libs.plugins.kotlin.jvm)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.ktlint)
    application
}

repositories {
    mavenCentral()
}

kotlin {
    jvmToolchain(21)
}

dependencies {
    implementation(libs.serialization.json)
    implementation(libs.ktor.server.routing.openapi)
    implementation(libs.ktor.server.netty)
    implementation(platform(libs.netty.bom))
    implementation(libs.ktor.server.content.negotiation)
    implementation(libs.ktor.serialization.kotlinx.json)
    implementation(libs.ktor.server.status.pages)
    implementation(libs.ktor.server.forwarded.header)
    implementation(libs.exposed.jdbc)
    implementation(libs.sqlite.jdbc)
    implementation(libs.flyway.core)
    implementation(libs.flyway.sqlite)
    implementation(libs.logback.classic)
    implementation(libs.sentry.logback)

    testImplementation(kotlin("test"))
    testImplementation(libs.ktor.server.test.host)
}

application {
    mainClass.set("forge.web.server.ServerKt")
}

tasks.named<JavaExec>("run") {
    workingDir = rootProject.projectDir
}

tasks.test {
    useJUnitPlatform()
}

// The compiled Bun server owns build/install/server. This distribution only feeds the cross-server handoff test.
tasks.named<Sync>("installDist") {
    destinationDir = layout.buildDirectory.dir("kotlin-install/server").get().asFile
}

tasks.register<Test>("generateOpenApi") {
    dependsOn(tasks.named("testClasses"))
    testClassesDirs = sourceSets.test.get().output.classesDirs
    classpath = sourceSets.test.get().runtimeClasspath
    useJUnitPlatform()
    filter {
        includeTestsMatching("*OpenApiExportTest")
        includeTestsMatching("*OpenApiContractTest")
        includeTestsMatching("*PuzzleRoutesTest")
    }
    systemProperty("forge.web.openapi.output", layout.buildDirectory.file("generated/openapi/openapi.json").get().asFile.absolutePath)
    val responsesDirectory = layout.buildDirectory.dir("generated/openapi/responses")
    doFirst { responsesDirectory.get().asFile.deleteRecursively() }
    outputs.upToDateWhen { false }
}

// Ship the same starter lists used by the lobby and local provisioning.
tasks.processResources {
    from(rootProject.layout.projectDirectory.dir("dev/decks")) {
        include("**/*.txt")
        into("starter-decks")
    }
}
