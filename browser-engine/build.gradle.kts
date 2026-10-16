plugins {
    alias(libs.plugins.kotlin.jvm)
    alias(libs.plugins.kotlin.serialization)
}

repositories {
    maven { url = uri(rootProject.layout.projectDirectory.dir("leyline/forge/.m2-local")) }
    mavenCentral()
}

kotlin { jvmToolchain(17) }

if (providers.gradleProperty("browserPrune").orElse("false").get().toBoolean()) {
    configurations.configureEach {
        exclude(group = "org.jetbrains.exposed")
        exclude(group = "org.xerial", module = "sqlite-jdbc")
        exclude(group = "io.netty")
        exclude(group = "org.eclipse.jetty")
        exclude(group = "at.yawk.lz4")
        exclude(group = "org.yaml", module = "snakeyaml")
        exclude(group = "com.google.protobuf", module = "protobuf-java-util")
        exclude(group = "org.jupnp", module = "org.jupnp.support")
        exclude(group = "com.apptasticsoftware", module = "rssreader")
        exclude(group = "org.tinylog", module = "slf4j-tinylog")
        // Browser Local has no Quest, Gauntlet, or Tournament persistence.
        exclude(group = "com.thoughtworks.xstream")
        exclude(group = "xmlpull")
        exclude(group = "io.github.x-stream")
        // Browser Local uses its own catalog and never runs Forge download helpers.
        exclude(group = "com.google.code.gson")
        // These annotations have no runtime behavior.
        exclude(group = "com.google.code.findbugs", module = "jsr305")
        exclude(group = "com.google.errorprone", module = "error_prone_annotations")
        exclude(group = "com.google.j2objc", module = "j2objc-annotations")
        exclude(group = "org.checkerframework", module = "checker-qual")
    }
}

dependencies {
    implementation(project(":card-presentation"))
    implementation("leyline:engine:0")
    implementation("leyline:domain:0")
    implementation("leyline:gre-proto:0")
    implementation(libs.serialization.json)
    testImplementation(kotlin("test"))
}

tasks.test {
    useJUnitPlatform()
    systemProperty("leyline.res.dir", rootProject.layout.projectDirectory.dir("leyline/forge/forge-gui/res").asFile.absolutePath)
    systemProperty("forge.web.test.root", rootProject.layout.projectDirectory.asFile.absolutePath)
}

tasks.register<JavaExec>("catalogIndex") {
    dependsOn(tasks.classes)
    classpath = sourceSets.main.get().runtimeClasspath
    mainClass.set("forge.web.browser.BrowserCatalogIndex")
    javaLauncher.set(javaToolchains.launcherFor { languageVersion.set(JavaLanguageVersion.of(17)) })
    args(rootProject.file("public/browser-engine/catalog").absolutePath)
    maxHeapSize = "512m"
}

tasks.register<Sync>("browserDistribution") {
    dependsOn(tasks.jar)
    from(tasks.jar)
    from(configurations.runtimeClasspath)
    into(rootProject.layout.projectDirectory.dir("public/browser-engine/lib"))
    doLast {
        val jars = destinationDir.listFiles().orEmpty().filter { it.extension == "jar" }.sortedBy { it.name }
        destinationDir.resolve("classpath.json").writeText(jars.joinToString(",", "[", "]") { "\"${it.name}\"" })
    }
}
