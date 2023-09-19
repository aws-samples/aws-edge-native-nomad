import { Duration } from "aws-cdk-lib"
import * as ssm from "aws-cdk-lib/aws-ssm"
import * as iam from "aws-cdk-lib/aws-iam"
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager"
import * as lambda from "aws-cdk-lib/aws-lambda"
import * as cr from "aws-cdk-lib/custom-resources"
import { Construct } from "constructs"

import * as path from "path"
import * as fs from "fs"

interface NomadAclProps {
    
  /**
   * the name of the secret storing the CA certificate
   */
  readonly caCertSecretName: string
  /**
   * nomad DNS name
   */
  readonly nomadDnsName: string

  /**
   * OIDC discovery URL
   */
  readonly oidcDiscoveryURL: string

  /**
   * OIDC client ID
   */
  readonly oidcClientId: string

  /**
   * OIDC client secret
   */
  readonly oidcClientSecret: string

}

export class NomadAcl extends Construct {


  
    constructor(scope: Construct, id: string, props: NomadAclProps) {
        super(scope, id)    

        const caCertificate =  secretsmanager.Secret.fromSecretNameV2(this,"ImportNomadCA",props.caCertSecretName)

        const bootstrapTokenParameter =  new secretsmanager.Secret(this,"BootstrapSecret",{
            secretName: "/infrastructure/nomad/token/bootstrap"
        })

        const policyContent = fs.readFileSync(path.join(__dirname,"policies/nomad-node-acl.hcl")).toString()

        const policyContentParameter =  new ssm.StringParameter(this,"PolicyContentSSMParameter",{
            parameterName : "/infrastructure/nomad/policies/submit-job",
            stringValue: policyContent,
            description: "Stores the  policy to submit job",
        })

        const tokenGeneratorRole = new iam.Role(this,"tokenGeneratorRole",{
            assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
            managedPolicies:[ iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSLambdaBasicExecutionRole")]
        },

        )
    
        bootstrapTokenParameter.grantWrite(tokenGeneratorRole)
        policyContentParameter.grantRead(tokenGeneratorRole)
        caCertificate.grantRead(tokenGeneratorRole)
    
        const tokenGeneratorLambda = new lambda.DockerImageFunction(this, "GenerateNomadToken", {
            code: lambda.DockerImageCode.fromImageAsset(path.join(__dirname, "lambda-acl")),
            role: tokenGeneratorRole,
            architecture: lambda.Architecture.X86_64,
            tracing: lambda.Tracing.ACTIVE,
            timeout: Duration.seconds(100),
            memorySize: 256,
            environment :{
                NOMAD_ADDRESS : props.nomadDnsName,
                OIDC_CLIENT_ID: props.oidcClientId,
                OIDC_CLIENT_SECRET: props.oidcClientSecret,
                OIDC_DISCOVERY_URL: props.oidcDiscoveryURL
            }
        })
        const invokeGenerateNomadToken = new cr.AwsCustomResource(this, "InvokeGenerateNomadToken", {
            onUpdate: { // will also be called for a CREATE event
                service: "Lambda",
                action: "invoke",
                parameters: {
                    FunctionName: tokenGeneratorLambda.functionName,
                    InvocationType: "RequestResponse",
                },
                physicalResourceId: cr.PhysicalResourceId.of(Date.now().toString()), // Update physical id to always fetch the latest version
            },
            policy: cr.AwsCustomResourcePolicy.fromStatements([
                new iam.PolicyStatement({
                    effect: iam.Effect.ALLOW,
                    resources: [tokenGeneratorLambda.functionArn],
                    actions: ["lambda:InvokeFunction"],
                }),
            ]),
        })
        invokeGenerateNomadToken.node.addDependency(tokenGeneratorLambda)
    }   
}