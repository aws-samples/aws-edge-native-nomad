import * as ec2 from "aws-cdk-lib/aws-ec2"
import * as logs from "aws-cdk-lib/aws-logs"
import * as iam from "aws-cdk-lib/aws-iam"
import {Construct} from "constructs"
import * as cdk from "aws-cdk-lib"

export class Network extends Construct {
    public readonly vpc: ec2.IVpc
    constructor(scope: Construct, id: string) {
        super(scope, id)

        const logGroup = new logs.LogGroup(this, "VPCFlowLog",{
            retention: logs.RetentionDays.ONE_DAY,
            removalPolicy: cdk.RemovalPolicy.DESTROY
        })

        const role = new iam.Role(this, "VPCFlowLogRole", {
            assumedBy: new iam.ServicePrincipal("vpc-flow-logs.amazonaws.com")
        })

        logGroup.grantWrite(role)
        logGroup.grantRead(role)


        const nomadVpc = new ec2.Vpc(this, "Vpc", {
            maxAzs: 3,
            ipAddresses: ec2.IpAddresses.cidr("10.0.0.0/16"),
            subnetConfiguration: [
                {
                    cidrMask: 28,
                    name: "public-subnet",
                    subnetType: ec2.SubnetType.PUBLIC
                },
                {
                    cidrMask: 24,
                    name: "private-subnet",
                    subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS
                },
      
            ],
            natGateways: 1,
            vpcName: "nomad-cluster",
            flowLogs: {
                "cloudwatch": {
                    destination : ec2.FlowLogDestination.toCloudWatchLogs(logGroup,role)
                }
            }
        })
        nomadVpc.addInterfaceEndpoint("ECRDockerENdpoint",{
            service: ec2.InterfaceVpcEndpointAwsService.ECR_DOCKER
        }).connections.allowInternally(ec2.Port.tcp(443))
        nomadVpc.addInterfaceEndpoint("ECRApiENdpoint",{
            service: ec2.InterfaceVpcEndpointAwsService.ECR
        }).connections.allowInternally(ec2.Port.tcp(443))
        this.vpc = nomadVpc
    }
}