import { Construct } from "constructs"
import * as cr from "aws-cdk-lib/custom-resources"
import * as stepfunctions from "aws-cdk-lib/aws-stepfunctions"
import * as iam from "aws-cdk-lib/aws-iam"
import * as lambda from "aws-cdk-lib/aws-lambda"
import * as cdk from "aws-cdk-lib"
import * as events from "aws-cdk-lib/aws-events"
import * as targets from "aws-cdk-lib/aws-events-targets"

import * as path from "path"
import * as fs from "fs"

interface SecretsManagerCertificateProps {

    acmPcaArn: string
    
    commonName: string
    
    subjectAlternativeName: string

    expiryDays: number

    secretPrefix: string
}


/**
   * A construct which issues a certificate from ACM PCA and stores it in Secrets Manager.
   *
   * @param acmPcaArn - The ARN of the ACM PCA used to sign the certificate
   * @param commonName - The CN of the certificate
   * @param subjectAlternativeName - A SAN to include in the certificate
   * @param expiryDays - The number of day's from today when the certificate will expire
   * @param secretPrefix -  The prefix of the secret in which the certificate and key is exported
   *
   */
export class SecretsManagerCertificate extends Construct {
    
    private csrLambda: lambda.DockerImageFunction

    constructor(scope: Construct, id: string, props: SecretsManagerCertificateProps) {
        super(scope, id)

        const sfnRole = this.getStepfunctionRole()
        const lambdaRole = this.getLambdaRole()

        this.csrLambda = new lambda.DockerImageFunction(this, "CSRFn", {
            role: lambdaRole,
            code: lambda.DockerImageCode.fromImageAsset(path.join(__dirname, "lambda")),
            description: "Creates a key and certificate signed by the provided CA.",
            architecture: lambda.Architecture.X86_64,
            tracing: lambda.Tracing.ACTIVE,
            timeout: cdk.Duration.seconds(100),
            memorySize: 256,
        })

        const generatorStateMachine = new stepfunctions.CfnStateMachine(this, "CertGenSfn" + props.subjectAlternativeName, {
            roleArn: sfnRole.roleArn,
            definitionString: fs.readFileSync(
                path.resolve(__dirname, "definition.json")
            ).toString("utf8"),
            definitionSubstitutions: {
                "csrLambdaName": this.csrLambda.functionName,
                "acmPcaArn": props.acmPcaArn,
                "commonName": props.commonName,
                "secretPrefix": props.secretPrefix,
                "subjectAlternativeName": props.subjectAlternativeName,
                "expiryDays": props.expiryDays.toString()
            },
            tracingConfiguration: {
                enabled: false
            }
        })

        const nomadCertStepfunction = stepfunctions.StateMachine.fromStateMachineArn(
            cdk.Stack.of(this),
            "nomadCertSfn" + props.subjectAlternativeName,
            cdk.Arn.format({
                partition: cdk.Stack.of(this).partition,
                account: cdk.Stack.of(this).account,
                region: cdk.Stack.of(this).region,
                service: "states",
                resource: "stateMachine",
                resourceName: generatorStateMachine.attrName,
                arnFormat: cdk.ArnFormat.COLON_RESOURCE_NAME
            })
        )

        // Trigger state machine execution when a certificate is installed
        const rule = new events.Rule(this, "Rule", {
            eventPattern: {
                source: ["aws.acm-pca"],
                detailType: ["AWS API Call via CloudTrail"], // Set detail type to AWS API Call via CloudTrail
                detail: {
                    eventName: ["ImportCertificateAuthorityCertificate"],
                },
            }
        })

        const eventsRole = new iam.Role(this, 'EventsRole', {
            assumedBy: new iam.ServicePrincipal('events.amazonaws.com'),
        });

        rule.addTarget(new targets.SfnStateMachine(nomadCertStepfunction, {
            input: events.RuleTargetInput.fromObject({ }),
            role: eventsRole
        }));
    }

    private getLambdaRole(): iam.Role {
        const role = new iam.Role(this, "lambdaRole", {
            assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
            inlinePolicies: {
                "Policy": new iam.PolicyDocument({
                    statements: [
                
                        new iam.PolicyStatement({
                            effect: iam.Effect.ALLOW,
                            actions: [
                                "logs:CreateLogGroup",
                                "logs:CreateLogStream",
                                "logs:PutLogEvents"
                            ],
                            resources: [
                                "*"
                            ]
                        }),
  
                        new iam.PolicyStatement({
                            effect: iam.Effect.ALLOW,
                            actions: [
                                "acm-pca:*",
                                "acm-pca:GetCertificate",
                                "acm-pca:IssueCertificate"
                            ],
                            resources: [
                                "*"
                            ]
                        })
                    ]
                })
            }
        })
  
        return (role)
    }

    /**
    * Returns a role allowing the state machine to perform the different steps of the generator.
    */
    private getStepfunctionRole(): iam.Role {
        const role = new iam.Role(this, "sfnRole", {
            assumedBy: new iam.ServicePrincipal("states.amazonaws.com"),
            inlinePolicies: {
                "Policy": new iam.PolicyDocument({
                    statements: [

                        // Allowing the role to send logs to AWS CloudWatch.
                        new iam.PolicyStatement({
                            effect: iam.Effect.ALLOW,
                            actions: [
                                "logs:CreateLogStream",
                                "logs:CreateLogDelivery",
                                "logs:GetLogDelivery",
                                "logs:UpdateLogDelivery",
                                "logs:DeleteLogDelivery",
                                "logs:ListLogDeliveries",
                                "logs:PutLogEvents",
                                "logs:PutResourcePolicy",
                                "logs:DescribeResourcePolicies",
                                "logs:DescribeLogGroups"
                            ],
                            resources: [
                                "*"
                            ]
                        }),
              
                        // Allowing the role to interact with the AWS IoT service
                        // in order to perform the generator.
                        new iam.PolicyStatement({
                            effect: iam.Effect.ALLOW,
                            actions: [
                                "iot:GetgeneratorCode",
                                "iot:RegisterCACertificate"
                            ],
                            resources: [
                                "*"
                            ]
                        }),

                        // Allowing the role to interact with the AWS Secrets
                        // Manager service.
                        new iam.PolicyStatement({
                            effect: iam.Effect.ALLOW,
                            actions: [
                                "secretsmanager:DescribeSecret",
                                "secretsmanager:GetSecretValue",
                                "secretsmanager:CreateSecret",
                                "secretsmanager:PutSecretValue"
                            ],
                            resources: [
                                "*"
                            ]
                        }),

                        // Allowing the role to send telemetry events to AWS X-Ray.
                        new iam.PolicyStatement({
                            effect: iam.Effect.ALLOW,
                            actions: [
                                "xray:PutTraceSegments",
                                "xray:PutTelemetryRecords",
                                "xray:GetSamplingRules",
                                "xray:GetSamplingTargets"
                            ],
                            resources: [
                                "*"
                            ]
                        }),

                        // Allowing the role to invoke the parser lambda function.
                        new iam.PolicyStatement({
                            effect: iam.Effect.ALLOW,
                            actions: [
                                "lambda:InvokeFunction"
                            ],
                            resources: [
                                "*"
                            ]
                        })
                    ]
                })
            }
        })

        return (role)
    }
}