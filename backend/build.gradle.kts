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

tasks.jar {
    manifest {
        attributes("Main-Class" to "in.petrolflow.Main")
    }
    duplicatesStrategy = DuplicatesStrategy.EXCLUDE
    from(configurations.runtimeClasspath.get().map { if (it.isDirectory) it else zipTree(it) })
}
