import org.gradle.api.attributes.java.TargetJvmVersion

plugins {
    alias(libs.plugins.kotlin.jvm)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.ktlint)
}

repositories {
    maven { url = uri(rootProject.layout.projectDirectory.dir("leyline/forge/.m2-local")) }
    mavenCentral()
}

kotlin { jvmToolchain(17) }

val runtimeJavaVersion = providers.gradleProperty("runtimeJavaVersion").orElse("21").get().toInt()

// Projection bytecode stays on Java 17; dependencies follow the selected runtime build.
configurations.matching { it.name.endsWith("Classpath") }.configureEach {
    attributes.attribute(TargetJvmVersion.TARGET_JVM_VERSION_ATTRIBUTE, runtimeJavaVersion)
}

dependencies {
    implementation("leyline:engine:0")
    implementation("leyline:domain:0")
    implementation("leyline:gre-proto:0")
    implementation(libs.serialization.json)
    testImplementation(kotlin("test"))
}

tasks.test {
    useJUnitPlatform()
    javaLauncher.set(javaToolchains.launcherFor { languageVersion.set(JavaLanguageVersion.of(runtimeJavaVersion)) })
    systemProperty("leyline.res.dir", rootProject.layout.projectDirectory.dir("leyline/forge/forge-gui/res").asFile.absolutePath)
}
