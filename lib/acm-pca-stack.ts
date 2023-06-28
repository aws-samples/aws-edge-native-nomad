import * as cdk from "aws-cdk-lib"
import { Construct } from "constructs"
import * as acmpca from "aws-cdk-lib/aws-acmpca"
import { SecretsManagerCertificate } from "./constructs/certificate"
import * as cr from "aws-cdk-lib/custom-resources"
import * as ssm from "aws-cdk-lib/aws-ssm"

export interface NomadProps extends cdk.StackProps{

  /**
   * the nomad region where the cluster is deployed
   */
  readonly nomadRegion: string


}


export class AcmPcaStack extends cdk.Stack {

    public caArn: string
  
    constructor(scope: Construct, id: string, props:NomadProps) {
        super(scope, id, props)

        const ca = new acmpca.CfnCertificateAuthority(this, "CA", {
            type: "ROOT",
            keyAlgorithm: "RSA_2048",
            signingAlgorithm: "SHA256WITHRSA",
            subject: {
                country: "US",
                organization: "Robot Company",
                organizationalUnit: "Robot Company Mission Department",
                state: "Washington",
                commonName: "Robot Company",
                serialNumber: "001",
                locality: "Seattle"
            },
        })

        this.caArn = ca.attrArn

        // Starting the step function to create the new server certificates.
        new cr.AwsCustomResource(this, "GeneratorCert" , {
            onDelete: {
                service: "ACMPCA",
                action: "updateCertificateAuthority",
                physicalResourceId: {
                    id: "DisableRobotCA"
                },
                parameters: {
                    CertificateAuthorityArn: ca.attrArn,
                    Status: "DISABLED"
                }
            },
            installLatestAwsSdk: true,
            policy: cr.AwsCustomResourcePolicy.fromSdkCalls({
                resources: cr.AwsCustomResourcePolicy.ANY_RESOURCE
            })
        })

        new SecretsManagerCertificate(this, "ServerCert", {
            acmPcaArn: ca.attrArn,
            commonName: `*.elb.${props.nomadRegion}.amazonaws.com`,
            subjectAlternativeName: `server.${props.nomadRegion}.nomad`,
            expiryDays: 365,
            secretPrefix: `nomad-server-${ props.nomadRegion}`
        })

        new ssm.StringParameter(this,"PrivateCAArn",{
            parameterName: "/infrastructure/pca/arn",
            stringValue: ca.attrArn,
            description: "ARN of the Private CA use to generate the certificate"
        })


    }
}
