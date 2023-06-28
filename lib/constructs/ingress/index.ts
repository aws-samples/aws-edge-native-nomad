import {Duration, RemovalPolicy} from "aws-cdk-lib"
import * as ec2 from "aws-cdk-lib/aws-ec2"
import {Construct} from "constructs"
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2"
import * as ecs from "aws-cdk-lib/aws-ecs"
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager"
import * as ssm from "aws-cdk-lib/aws-ssm"

export interface IngressProps {

  /**
   * The VPC where the nomad cluster is deployed
   */
   readonly nomadVpc:ec2.IVpc

  /**
   * The prefix used for the LB name
   */
  readonly lbPrefix: string
}


export class Ingress extends Construct {
  
    /**
   * the DNS of the load balancer 
   */
    public readonly lbDnsName: string
    /**
   * the HTTP listener for nomad cluster
   */
    private httpListener: elbv2.NetworkListener
    /**
   * the HTTP listener for nomad cluster
   */
    private rpcListener: elbv2.NetworkListener
  
  
    constructor(scope: Construct, id: string, props: IngressProps) {
        super(scope, id)

        const templatedSecret = new secretsmanager.Secret(this, "TemplatedSecret", {
            generateSecretString: {
                excludeUppercase: true,
                excludePunctuation: true,
                includeSpace: false,
                passwordLength: 20
            },
            removalPolicy: RemovalPolicy.DESTROY,
        })
        // Creating a network load-balancer for Nomad.
        const nlb = new elbv2.NetworkLoadBalancer(this, "Nlb", {
            vpc: props.nomadVpc,
            loadBalancerName: templatedSecret.secretValue.unsafeUnwrap(),
            vpcSubnets: props.nomadVpc.selectSubnets({
                subnetType: ec2.SubnetType.PUBLIC
            }),
            internetFacing: true
        })

        new ssm.StringParameter(this,"NomadDNS", {
            description: "URL of the nomad cluster",
            stringValue: nlb.loadBalancerDnsName,
            parameterName: "/infrastructure/nomad/endpoint"
        })


        // HTTP / HTTPS listener.
        this.httpListener = nlb.addListener("Http", {
            port: 4646,
            protocol: elbv2.Protocol.TCP,
        })

        // RPC listener.
        this.rpcListener = nlb.addListener("Rpc", {
            port: 4647,
            protocol: elbv2.Protocol.TCP,
        })


    
        this.lbDnsName = nlb.loadBalancerDnsName
    }
  
    updateListener(service: ecs.Ec2Service): void {
        // Adding a listener to the HTTP interface of Nomad.
        this.httpListener.addTargets("Http", {
            targets: [service],
            port: 4646,
            protocol: elbv2.Protocol.TCP,
            healthCheck: {
                enabled: true,
                interval: Duration.seconds(30)
            }
        })

        // Adding a listener to the RPC interface of Nomad.
        this.rpcListener.addTargets("Rpc", {
            targets: [service.loadBalancerTarget({
                containerName:"NomadServerContainer",
                containerPort:4647
            })],
            port: 4647,
            protocol: elbv2.Protocol.TCP,
            healthCheck: {
                enabled: true,
                interval: Duration.seconds(30)
            }
        })
    
    }
}