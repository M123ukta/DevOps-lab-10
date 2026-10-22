def run(String cmd) {
    if (isUnix()) { sh cmd } else { bat cmd }
}
def runStatus(String cmd) {
    return isUnix() ? sh(script: cmd, returnStatus: true) : bat(script: cmd, returnStatus: true)
}
def capture(String cmd) {
    return isUnix() ? sh(script: cmd, returnStdout: true).trim()
                    : bat(script: "@${cmd}", returnStdout: true).trim()
}

// Render deployment.yaml placeholders into build/deployment.rendered.yaml
def renderManifest() {
    def cause = "Jenkins #${env.BUILD_NUMBER}: ${env.IMAGE} (${params.RELEASE_TYPE}, commit ${env.GIT_SHORT})"
    def yaml = readFile('deployment.yaml')
            .replace('__IMAGE__', env.IMAGE)
            .replace('__APP_VERSION__', env.IMAGE_TAG)
            .replace('__CHANGE_CAUSE__', cause)
    writeFile file: 'build/deployment.rendered.yaml', text: yaml
    return yaml
}

def deployedImage() {
    return capture("kubectl get deployment ${env.APP_NAME} -n ${env.K8S_NAMESPACE} --ignore-not-found " +
                   "-o \"jsonpath={.spec.template.spec.containers[0].image}\"")
}

// Smoke test the running release inside the cluster: health endpoint, version and dashboard content
def smokeTest(String expectedVersion) {
    try {
        def target = "deployment/${env.APP_NAME} -n ${env.K8S_NAMESPACE}"
        def health = capture("kubectl exec ${target} -- wget -qO- http://127.0.0.1/health.json")
        def page   = capture("kubectl exec ${target} -- wget -qO- http://127.0.0.1/")
        echo "Health endpoint: ${health}"
        boolean ok = health.contains('"status":"UP"') &&
                     health.contains("\"version\":\"${expectedVersion}\"") &&
                     page.contains('AquaGrid') &&
                     !page.contains('const TELEMETRY_FEED = "offline"')
        echo(ok ? "Smoke test PASSED for ${expectedVersion}" : "Smoke test FAILED for ${expectedVersion}")
        return ok
    } catch (err) {
        echo "Smoke test FAILED: ${err}"
        return false
    }
}

pipeline {
    agent any

    parameters {
        string(name: 'DOCKERHUB_REPO', defaultValue: 'muktamotwani/water-dashboard',
               description: 'Docker Hub repository (username/repository)')
        choice(name: 'RELEASE_TYPE', choices: ['stable', 'faulty'],
               description: 'stable = normal release | faulty = deliberately broken release to demonstrate failed rollout + automatic rollback')
        booleanParam(name: 'RUN_TESTS', defaultValue: true, description: 'Run unit tests and manifest validation (parallel)')
        booleanParam(name: 'PUSH_IMAGE', defaultValue: true, description: 'Push the image to Docker Hub')
        booleanParam(name: 'DEPLOY_TO_K8S', defaultValue: true, description: 'Deploy to Kubernetes (Docker Desktop)')
        string(name: 'ROLLOUT_TIMEOUT', defaultValue: '120s', description: 'Max time to wait for a rollout to become healthy')
    }

    environment {
        APP_NAME        = 'water-dashboard'
        K8S_NAMESPACE   = 'default'
        DOCKERHUB_CRED  = 'dockerhub'
        KUBECONFIG_CRED = 'kubeconfig'
        DOCKER_BUILDKIT = '1'
    }

    options {
        buildDiscarder(logRotator(numToKeepStr: '20'))
        disableConcurrentBuilds()
        timeout(time: 30, unit: 'MINUTES')
    }

    stages {
        stage('Checkout') {
            steps {
                checkout scm
                script {
                    env.GIT_SHORT = capture('git rev-parse --short HEAD')
                    env.IMAGE_TAG = "v${env.BUILD_NUMBER}" + (params.RELEASE_TYPE == 'faulty' ? '-faulty' : '')
                    env.IMAGE     = "${params.DOCKERHUB_REPO}:${env.IMAGE_TAG}"
                    env.ROLLOUT_FAILED = 'false'
                    currentBuild.displayName = "#${env.BUILD_NUMBER} ${env.IMAGE_TAG}"
                    echo "Building ${env.IMAGE} from commit ${env.GIT_SHORT}"
                }
            }
        }

        stage('Build & Test') {
            when { expression { params.RUN_TESTS } }
            parallel {
                stage('Unit Tests') {
                    steps {
                        script { run("docker build --target test -t ${env.APP_NAME}-test:${env.IMAGE_TAG} .") }
                    }
                }
                stage('Validate K8s Manifest') {
                    steps {
                        script {
                            def yaml = renderManifest()
                            if (yaml.contains('__')) { error('Unrendered __PLACEHOLDER__ left in manifest') }
                            ['kind: Deployment', 'kind: Service', 'readinessProbe', 'RollingUpdate', 'progressDeadlineSeconds']
                                .each { if (!yaml.contains(it)) { error("deployment.yaml is missing '${it}'") } }
                            echo 'Kubernetes manifest validated'
                        }
                    }
                }
                stage('Build Metadata') {
                    steps {
                        script {
                            writeFile file: 'build/build-info.txt', text: """application : ${env.APP_NAME}
image       : ${env.IMAGE}
release     : ${params.RELEASE_TYPE}
commit      : ${env.GIT_SHORT}
build       : ${env.BUILD_NUMBER}
built at    : ${new Date()}
"""
                        }
                    }
                }
            }
        }

        stage('Build Docker Image') {
            steps {
                script {
                    def faulty = params.RELEASE_TYPE == 'faulty'
                    run("docker build --build-arg APP_VERSION=${env.IMAGE_TAG} --build-arg FAULTY=${faulty} -t ${env.IMAGE} .")
                    if (!faulty) { run("docker tag ${env.IMAGE} ${params.DOCKERHUB_REPO}:latest") }
                }
            }
        }

        stage('Run & Verify Container') {
            steps {
                script {
                    def cname = "wd-verify-${env.BUILD_NUMBER}"
                    runStatus("docker rm -f ${cname}")
                    try {
                        run("docker run -d --name ${cname} ${env.IMAGE}")
                        sleep(time: 5, unit: 'SECONDS')
                        def page = capture("docker exec ${cname} wget -qO- http://127.0.0.1/")
                        if (!page.contains('AquaGrid') || !page.contains(env.IMAGE_TAG)) {
                            error('Container did not serve the dashboard')
                        }
                        echo "Container ${cname} is serving the AquaGrid dashboard (${env.IMAGE_TAG})"
                    } finally {
                        runStatus("docker rm -f ${cname}")
                    }
                }
            }
        }

        stage('Push to Docker Hub') {
            when { expression { params.PUSH_IMAGE } }
            steps {
                script {
                    withCredentials([usernamePassword(credentialsId: env.DOCKERHUB_CRED,
                                                      usernameVariable: 'DH_USER', passwordVariable: 'DH_PASS')]) {
                        if (isUnix()) {
                            sh 'echo "$DH_PASS" | docker login -u "$DH_USER" --password-stdin'
                        } else {
                            bat '@echo %DH_PASS%| docker login -u %DH_USER% --password-stdin'
                        }
                        run("docker push ${env.IMAGE}")
                        if (params.RELEASE_TYPE == 'stable') { run("docker push ${params.DOCKERHUB_REPO}:latest") }
                        runStatus('docker logout')
                    }
                }
            }
        }

        stage('Deploy to Kubernetes') {
            when { expression { params.DEPLOY_TO_K8S } }
            steps {
                script {
                    renderManifest()
                    withCredentials([file(credentialsId: env.KUBECONFIG_CRED, variable: 'KUBECONFIG')]) {
                        env.PREVIOUS_IMAGE = deployedImage()
                        echo "Currently deployed: ${env.PREVIOUS_IMAGE ?: '(nothing – first deployment)'}"
                        run("kubectl apply -n ${env.K8S_NAMESPACE} -f build/deployment.rendered.yaml")
                    }
                }
            }
        }

        stage('Verify Rollout') {
            when { expression { params.DEPLOY_TO_K8S } }
            steps {
                script {
                    withCredentials([file(credentialsId: env.KUBECONFIG_CRED, variable: 'KUBECONFIG')]) {
                        int rc = runStatus("kubectl rollout status deployment/${env.APP_NAME} -n ${env.K8S_NAMESPACE} --timeout=${params.ROLLOUT_TIMEOUT}")
                        if (rc == 0 && !smokeTest(env.IMAGE_TAG)) { rc = 1 }
                        if (rc != 0) {
                            env.ROLLOUT_FAILED = 'true'
                            echo "!!! ROLLOUT FAILED for ${env.IMAGE} – collecting diagnostics"
                            def ns = env.K8S_NAMESPACE
                            def diag = "=== PODS ===\n" +
                                capture("kubectl get pods -n ${ns} -l app=${env.APP_NAME} -o wide") +
                                "\n\n=== DEPLOYMENT ===\n" + capture("kubectl describe deployment ${env.APP_NAME} -n ${ns}") +
                                "\n\n=== EVENTS ===\n" + capture("kubectl get events -n ${ns} --sort-by=.lastTimestamp")
                            writeFile file: 'build/failed-rollout-diagnostics.txt', text: diag
                            echo diag
                        } else {
                            echo "Rollout of ${env.IMAGE} is healthy"
                        }
                    }
                }
            }
        }

        stage('Automated Rollback') {
            when { expression { params.DEPLOY_TO_K8S && env.ROLLOUT_FAILED == 'true' } }
            steps {
                script {
                    withCredentials([file(credentialsId: env.KUBECONFIG_CRED, variable: 'KUBECONFIG')]) {
                        def ns = env.K8S_NAMESPACE
                        if (!env.PREVIOUS_IMAGE) { error('Rollout failed and there is no previous release to roll back to') }
                        echo "Rolling back ${env.APP_NAME} from ${env.IMAGE} to ${env.PREVIOUS_IMAGE}"
                        run("kubectl rollout undo deployment/${env.APP_NAME} -n ${ns}")
                        run("kubectl rollout status deployment/${env.APP_NAME} -n ${ns} --timeout=${params.ROLLOUT_TIMEOUT}")

                        def restored = deployedImage()
                        def restoredTag = restored.substring(restored.lastIndexOf(':') + 1)
                        if (!smokeTest(restoredTag)) { error("Restored release ${restored} failed its smoke test") }

                        def history = capture("kubectl rollout history deployment/${env.APP_NAME} -n ${ns}")
                        def pods    = capture("kubectl get pods -n ${ns} -l app=${env.APP_NAME} -o wide")
                        writeFile file: 'build/rollback-report.txt',
                                  text: "Failed release : ${env.IMAGE}\nRestored       : ${restored}\n\n${history}\n\n${pods}\n"
                        echo "ROLLBACK COMPLETE – ${restored} is serving traffic and passed the smoke test\n${history}"
                        currentBuild.description = "Rolled back ${env.IMAGE_TAG} -> ${restoredTag}"
                        currentBuild.result = 'FAILURE'   // the release itself failed, even though service was restored
                    }
                }
            }
        }
    }

    post {
        always {
            archiveArtifacts artifacts: 'index.html, deployment.yaml, build/**', allowEmptyArchive: true, fingerprint: true
        }
        success {
            echo "SUCCESS: ${env.IMAGE} built, tested${params.PUSH_IMAGE ? ', pushed' : ''}${params.DEPLOY_TO_K8S ? ' and deployed – http://localhost:30080' : ''}"
        }
        failure {
            echo "FAILURE: see archived build/ artifacts (diagnostics / rollback report)."
        }
    }
}
