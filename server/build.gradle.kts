plugins {
    alias(libs.plugins.kotlin.jvm)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.ktlint)
    application
}

repositories {
    maven {
        url = uri(rootProject.layout.projectDirectory.dir("leyline/forge/.m2-local"))
        content { includeGroup("forge") }
    }
    mavenCentral()
}

kotlin {
    jvmToolchain(21)
}

configurations.all {
    exclude(group = "org.eclipse.jetty")
    exclude(group = "org.eclipse.jetty.alpn")
    exclude(group = "javax.servlet")
    exclude(group = "org.tinylog", module = "slf4j-tinylog")
}

dependencies {
    implementation(project(":card-presentation"))
    implementation("leyline:domain:0")
    implementation("leyline:engine:0")
    implementation("leyline:gre-proto:0")
    implementation(libs.protobuf.java.util)
    implementation(libs.serialization.json)
    implementation(libs.tomlkt)
    implementation("io.ktor:ktor-server-routing-openapi:${libs.versions.ktor.get()}")
    implementation(libs.ktor.server.netty)
    implementation(libs.ktor.server.content.negotiation)
    implementation(libs.ktor.serialization.kotlinx.json)
    implementation(libs.ktor.server.status.pages)
    implementation("io.ktor:ktor-server-forwarded-header:${libs.versions.ktor.get()}")
    implementation(libs.exposed.jdbc)
    implementation(libs.sqlite.jdbc)
    implementation("org.flywaydb:flyway-core:13.5.0")
    implementation("org.flywaydb:flyway-database-nc-sqlite:13.5.0")
    implementation(libs.logback.classic)
    implementation(libs.sentry.logback)

    testImplementation(kotlin("test"))
    testImplementation(libs.ktor.server.test.host)
    testImplementation(testFixtures("leyline:domain:0"))
}

application {
    mainClass.set("forge.web.server.ServerKt")
}

tasks.named<JavaExec>("run") {
    workingDir = rootProject.projectDir
}

tasks.named("check") { dependsOn(":card-presentation:check") }

tasks.test {
    useJUnitPlatform()
    systemProperty("leyline.res.dir", rootProject.layout.projectDirectory.dir("leyline/forge/forge-gui/res").asFile.absolutePath)
    systemProperty("forge.web.test.content.root", rootProject.layout.projectDirectory.dir("leyline").asFile.absolutePath)
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
    systemProperty("forge.web.test.content.root", rootProject.layout.projectDirectory.dir("leyline").asFile.absolutePath)
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
