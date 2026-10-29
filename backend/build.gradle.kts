plugins {
    java
    application
}

group = "in.petrolflow"
version = "1.0.0"

java {
    sourceCompatibility = JavaVersion.VERSION_21
    targetCompatibility = JavaVersion.VERSION_21
}

application {
    mainClass.set("in.petrolflow.Main")
}

tasks.withType<JavaCompile> {
    options.encoding = "UTF-8"
    options.release.set(21)
}

tasks.named<JavaExec>("run") {
    workingDir = rootProject.projectDir.parentFile
    standardInput = System.`in`
}

tasks.register<JavaExec>("simulateGateway") {
    group = "application"
    description = "Run the Java 21 forecourt gateway simulator CLI"
    classpath = sourceSets["main"].runtimeClasspath
    mainClass.set("in.petrolflow.GatewaySimulator")
    workingDir = rootProject.projectDir.parentFile
}

val verifyJava = tasks.register<JavaExec>("verifyJava") {
    group = "verification"
    description = "Run PetroFlow Java 21 unit and MySQL HTTP integration tests"
    dependsOn("testClasses")
    classpath = sourceSets["test"].runtimeClasspath
    mainClass.set("in.petrolflow.BackendTests")
    workingDir = rootProject.projectDir.parentFile
}

tasks.named("check") {
    dependsOn(verifyJava)
}

tasks.jar {
    manifest {
        attributes("Main-Class" to "in.petrolflow.Main")
    }
    duplicatesStrategy = DuplicatesStrategy.EXCLUDE
    from(configurations.runtimeClasspath.get().map { if (it.isDirectory) it else zipTree(it) })
}
