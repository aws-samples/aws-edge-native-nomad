import {Construct} from "constructs"
import * as cognito from "aws-cdk-lib/aws-cognito"
import * as cdk from "aws-cdk-lib"


interface AuthenticationProps {
  clusterDns: string
  userName: string
  userEmail: string
  domainPrefix: string
}


/**
 * A construct which issues a certificate from ACM PCA and stores it in Secrets Manager.
 *

 *
 */
export class Authentication extends Construct {
  
    public oidcClientId: string
    public oidcClientSecret: string
    public oidcDiscoveryUrl: string

    constructor(scope: Construct, id: string, props: AuthenticationProps) {
        super(scope, id)


        const userpool = new cognito.UserPool(this, "Pool", {
            userPoolName: "administrator",
            removalPolicy : cdk.RemovalPolicy.DESTROY
        })
        const client = userpool.addClient("Client", {
            generateSecret: true,
            oAuth: {
                flows: {
                    implicitCodeGrant: true,
                    authorizationCodeGrant: true
                },
                callbackUrls: [
                    `https://${props.clusterDns}:4646/ui/settings/tokens`,
                    "http://localhost:4649/oidc/callback"
                ],
            },
        })
        userpool.addDomain("Domain", {
            cognitoDomain : {
                // This needs to be globally unique for the region - https://{domain}.auth.{region}.amazoncognito.com
                domainPrefix: props.domainPrefix
            }
        })
        this.oidcClientId = client.userPoolClientId
        this.oidcClientSecret = client.userPoolClientSecret.unsafeUnwrap()
        this.oidcDiscoveryUrl = userpool.userPoolProviderUrl
        const group = new cognito.CfnUserPoolGroup(this,"EnginneringGroup",{
            userPoolId: userpool.userPoolId,
            groupName: "engineering"
        })
        const adminUser = new cognito.CfnUserPoolUser(this,"Adminstrator", {
            userPoolId: userpool.userPoolId,
            username: props.userName,
            desiredDeliveryMediums: ["EMAIL"],
            userAttributes: [
                {
                    name: "email",
                    value: props.userEmail
                }
            ],
            validationData: [{
                name: "email",
                value: props.userEmail
            }
            ]
        }
        )


        const attachement = new cognito.CfnUserPoolUserToGroupAttachment(this, "AttachUser",{
            userPoolId:userpool.userPoolId,
            username: adminUser.username || "undefined",
            groupName: group.groupName || "undefined"
        })
        attachement.node.addDependency(adminUser)
        attachement.node.addDependency(group)
    }

}
