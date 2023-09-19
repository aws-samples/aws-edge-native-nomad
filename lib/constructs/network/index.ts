import * as ec2 from "aws-cdk-lib/aws-ec2"
import { Construct } from "constructs"

export class Network extends Construct {
    public readonly vpc: ec2.IVpc
    constructor(scope: Construct, id: string) {
        super(scope, id)
    
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
            vpcName: "nomad-cluster"
        })
        nomadVpc.addInterfaceEndpoint('ECRDockerENdpoint',{
            service: ec2.InterfaceVpcEndpointAwsService.ECR_DOCKER
        }).connections.allowInternally(ec2.Port.tcp(443))
        nomadVpc.addInterfaceEndpoint('ECRApiENdpoint',{
            service: ec2.InterfaceVpcEndpointAwsService.ECR
        }).connections.allowInternally(ec2.Port.tcp(443))
        this.vpc = nomadVpc
    }
}