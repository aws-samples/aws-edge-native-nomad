import * as cdk from "aws-cdk-lib"
import { Construct } from "constructs"
import * as rolesanywhere from "aws-cdk-lib/aws-rolesanywhere"
import * as iam from "aws-cdk-lib/aws-iam"
import * as ssm from "aws-cdk-lib/aws-ssm"

export interface IamAnyStackProps extends cdk.StackProps {
    acmPcaArn: string
}

export class IamAnyStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props: IamAnyStackProps, ) {
        super(scope, id, props)

        const cfnTrustAnchor = new rolesanywhere.CfnTrustAnchor(this, "CfnTrustAnchor", {
            enabled: true,
            name: "CfnTrustAnchor",
            source: {
                sourceData: {
                    acmPcaArn: props.acmPcaArn,
                },
                sourceType: "AWS_ACM_PCA",
            }
        })

        const policyRole = this.getPolicyRole()

        const cfnProfile = new rolesanywhere.CfnProfile(this, "CfnProfile", {
            name: "CfnProfile",
            durationSeconds: 3600,
            enabled: true,
            roleArns: [ policyRole.roleArn ]
        })

        const credential_process_string = `credential_process = aws_signing_helper credential-process \
        --certificate /root/certificates/device.pem \
        --private-key /root/certificates/device-key.pem \
        --trust-anchor-arn ${cfnTrustAnchor.attrTrustAnchorArn} \
        --profile-arn ${cfnProfile.attrProfileArn} \
        --role-arn ${policyRole.roleArn}
    `
        // Save the ARN in SSM parameter so they can be read later by ansible
        new ssm.StringParameter(this,"TrustAnchorArnParameter",{
            parameterName: "/infrastructure/trust_anchor/arn",
            stringValue:   cfnTrustAnchor.attrTrustAnchorArn,
            description: "ARN of the trust anchor used by IAM role anywhere"
        })

        new ssm.StringParameter(this,"ProfileArnParameter",{
            parameterName: "/infrastructure/profile/arn",
            stringValue:   cfnProfile.attrProfileArn,
            description: "ARN of the profile used by IAM role anywhere"
        })

        new ssm.StringParameter(this,"RoleArnParameter",{
            parameterName: "/infrastructure/role/arn",
            stringValue:   policyRole.roleArn,
            description: "ARN of the IAM Role used by IAM role anywhere"
        })
        // Print the outputs to reference in the credentials process command string
        new cdk.CfnOutput(this, "TrustAnchorArn", { value: cfnTrustAnchor.attrTrustAnchorArn })
        new cdk.CfnOutput(this, "ProfileArn", { value: cfnProfile.attrProfileArn })
        new cdk.CfnOutput(this, "RoleArn", { value: policyRole.roleArn })
        new cdk.CfnOutput(this, "CredentialsProcessString", { value: credential_process_string })

    }


    // This should be restricted to the least privilege based on the access required for the use-case
    private getPolicyRole(): iam.Role {
        const role = new iam.Role(this, "iamRolesAnywhereProfileRole", {
            assumedBy:  new iam.ServicePrincipal("rolesanywhere.amazonaws.com"),
            managedPolicies: [
                iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonEC2ContainerRegistryFullAccess"),
                iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonKinesisFullAccess"),
                iam.ManagedPolicy.fromAwsManagedPolicyName("AWSIoTDataAccess"),
                iam.ManagedPolicy.fromAwsManagedPolicyName("AdministratorAccess"),
            ],
            inlinePolicies: {
                "Policy": new iam.PolicyDocument({
                    statements: [
                        new iam.PolicyStatement({
                            effect: iam.Effect.ALLOW,
                            actions: [
                                "ecr:GetAuthorizationToken"
                    
                            ],
                            resources: [
                                "*"
                            ]
                        }),  
                        new iam.PolicyStatement({
                            effect: iam.Effect.ALLOW,
                            actions: [
                                "kinesis:PutRecord"
                        
                            ],
                            resources: [
                                `arn:${cdk.Aws.PARTITION}:ecr:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:stream/*`
                            ]
                        }),
                        new iam.PolicyStatement({
                            effect: iam.Effect.ALLOW,
                            actions: [
                                "s3:DeleteObject",
                                "s3:GetObject",
                                "s3:PutObject"
                            ],
                            resources: [
                                "arn:aws:s3:::my-bucket-name/*"
                            ]
                        }),
                    ]
                })
            }
        })

        // These STS Actions are required by IAM Roles Anywhere to allow the rolesanywhere principle permissions to assume the given role.
        // https://docs.aws.amazon.com/rolesanywhere/latest/userguide/getting-started.html#getting-started-step2
        role.assumeRolePolicy?.addStatements(
            new iam.PolicyStatement({
                actions: [
                    "sts:AssumeRole",
                    "sts:TagSession",
                    "sts:SetSourceIdentity"
                ],
                principals: [new iam.ServicePrincipal("rolesanywhere.amazonaws.com")]
            }),
        )

        return (role)
    }
}
