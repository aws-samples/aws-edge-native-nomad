import { Tags,RemovalPolicy } from "aws-cdk-lib"
import * as ec2 from "aws-cdk-lib/aws-ec2"
import * as ecs from "aws-cdk-lib/aws-ecs"
import * as autoscaling from "aws-cdk-lib/aws-autoscaling"
import * as iam from "aws-cdk-lib/aws-iam"
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager"
import * as logs from "aws-cdk-lib/aws-logs"
import * as efs from "aws-cdk-lib/aws-efs"
import * as ecr_assets from "aws-cdk-lib/aws-ecr-assets"
import { Construct } from "constructs"
import * as path from "path"

interface ClusterProps {

  /**
   * The VPC where the nomad cluster is deployed
   */
   readonly nomadVpc:ec2.IVpc
   
  /**
   * The  DNS name used to advertise the nomad cluster
   */
   readonly lbDnsName: string
  
  /**
   * the nomad region where the cluster is deployed
   */
  readonly nomadRegion: string

  /**
   * the AWS region where the nomad cluster is deployed
   */
  readonly awsRegion: string

  /**
   * the key of the tag used for server discovery
   */
  readonly discoveryTagKey: string
    
  /**
   * the value of the tag used for server discovery
   */
  readonly discoveryTagValue: string
  
  /**
   * the number of nomad server participating in the cluster
   */
  readonly instanceCount: number
  
  /**
   * the name of the data center hosting the cluster of nomad server
   */
  readonly dataCenterName: string
  
  /**
   * the name of the secret storing the CA certificate
   */
  caCertSecretName: string
  
  /**
   * the name of the secret storing the nomad server certificate
   */
  serverCertSecretName: string
  
  /**
   * the name of the secret storing the nomad server certificate
   */
  serverPrivateKeySecretName: string
  
}

export class Cluster extends Construct {
    /**
   * the  ECS service managing th nomad server
   */
    public service: ecs.Ec2Service

  
  
    constructor(scope: Construct, id: string, props: ClusterProps) {
        super(scope, id)    
     
        const nomadInstanceRole = new iam.Role(this, "NomadInstanceRole", {
            assumedBy: new iam.ServicePrincipal("ec2.amazonaws.com")
        })
        nomadInstanceRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonSSMManagedInstanceCore"))
    
        const nomadSg = new ec2.SecurityGroup(this,"NomadSg",{
            vpc: props.nomadVpc,
            allowAllOutbound: true,
            description: "Security group for managing the traffic inside a nomad cluster",
            securityGroupName: "nomad-sg"
        })
    
        nomadSg.addIngressRule(ec2.Peer.ipv4(props.nomadVpc.vpcCidrBlock),ec2.Port.tcpRange(4646,4648),"nomad traffic")
        nomadSg.addIngressRule(ec2.Peer.anyIpv4(),ec2.Port.tcpRange(4646,4648),"nomad traffic")
        nomadSg.addIngressRule(ec2.Peer.ipv4(props.nomadVpc.vpcCidrBlock),ec2.Port.udp(4648),"nomad traffic (UDP)")
        nomadSg.addIngressRule(ec2.Peer.ipv4(props.nomadVpc.vpcCidrBlock),ec2.Port.tcp(2049),"EFS traffic")
    
        const nomadLt = new ec2.LaunchTemplate(this, "NomadServerLT", {
            instanceType: new ec2.InstanceType("t3.medium"),
            machineImage: ecs.EcsOptimizedImage.amazonLinux2(),
            userData: ec2.UserData.forLinux(),
            role: nomadInstanceRole,
            securityGroup: nomadSg
        })

        /**
         * Tags to add:
         *  key : "nomad-type"
         *  value: "server"
         */
        Tags.of(nomadLt).add(props.discoveryTagKey,props.discoveryTagValue) 
     
    

        const nomadAsg = new autoscaling.AutoScalingGroup(this, "NomadServerASG", {
            vpc:props.nomadVpc,
            launchTemplate:nomadLt,
            newInstancesProtectedFromScaleIn: false,
            desiredCapacity: props.instanceCount,
            minCapacity: props.instanceCount,
            maxCapacity: props.instanceCount
        })
    
        const nomadCp = new ecs.AsgCapacityProvider(this, "AsgCapacityProvider", {
            autoScalingGroup: nomadAsg,
            enableManagedScaling: false,
            enableManagedTerminationProtection: false
        })


        /**
         * Importing certificates as secret
         */
        const caCertificate =  secretsmanager.Secret.fromSecretNameV2(this,"ImportNomadCA",props.caCertSecretName)
        const serverCertificate =  secretsmanager.Secret.fromSecretNameV2(this,"ImportServerCA",props.serverCertSecretName)
        const serverPrivateKey =  secretsmanager.Secret.fromSecretNameV2(this,"ImportPrivateKeyCA",props.serverPrivateKeySecretName)

    
        /**
         * Persistent volume
         */

        // A filesystem dedicated to storing state from the Nomad servers.
        const fileSystem = new efs.FileSystem(this, "Storage", {
            vpc: props.nomadVpc,
            lifecyclePolicy: efs.LifecyclePolicy.AFTER_14_DAYS,
            performanceMode: efs.PerformanceMode.GENERAL_PURPOSE,
            throughputMode: efs.ThroughputMode.BURSTING,
            vpcSubnets: {
                subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
                onePerAz: true
            },
            securityGroup: nomadSg
        })

        fileSystem.applyRemovalPolicy(RemovalPolicy.DESTROY)

        // The access point through which ECS tasks will interact with the EFS filesystem.
        const accessPoint = new efs.AccessPoint(this, "AccessPoint", { fileSystem })


        /**
         * Container section
         */
        const nomadCluster = new ecs.Cluster(this, "NomadComputeResource", { 
            vpc:props.nomadVpc, 
            clusterName: "nomad-cluster",
            containerInsights: true
        })
    
        nomadCluster.addAsgCapacityProvider(nomadCp,{
            canContainersAccessInstanceRole: false
        })
    
        const nomadTaskDefinition = new ecs.Ec2TaskDefinition(this, "NomadServerTaskDefinition", {
            family: "nomad-server-task-definition",
            networkMode: ecs.NetworkMode.HOST
        })
        nomadTaskDefinition.taskRole.attachInlinePolicy(new iam.Policy(this,"DescribeInstancePolicyForNomadServer",{
            statements: [new iam.PolicyStatement({
                actions: ["ec2:DescribeInstances"],
                resources: ["*"]
            })]
        }))
        // Allowing Nomad servers to mount the EFS filesystem.
        nomadTaskDefinition.taskRole.attachInlinePolicy(new iam.Policy(this,"AttacheEFSVolumePolicyForNomadServer",{
            statements:[
                new iam.PolicyStatement({
                    effect: iam.Effect.ALLOW,
                    actions: [
                        "elasticfilesystem:ClientRootAccess",
                        "elasticfilesystem:ClientWrite",
                        "elasticfilesystem:ClientMount",
                        "elasticfilesystem:DescribeMountTargets"
                    ],
                    resources: [fileSystem.fileSystemArn]
                })]
        }))

        const efsVolumeName = "nomad-volume"
        // Adding the EFS cluster on the task definition.
        nomadTaskDefinition.addVolume({
            name: efsVolumeName,
            efsVolumeConfiguration: {
                fileSystemId: fileSystem.fileSystemId,
                transitEncryption: "ENABLED",
                authorizationConfig:{
                    accessPointId: accessPoint.accessPointId,
                    iam: "ENABLED"
                }
            }
        })

    
        const nomadContainer = nomadTaskDefinition.addContainer("NomadServerContainer", {
            image: ecs.ContainerImage.fromAsset(path.join(__dirname,"nomad-server"), {
                platform: ecr_assets.Platform.LINUX_AMD64
            }),
            memoryLimitMiB: 256,
            environment: {
                REGION: props.nomadRegion,
                AWS_REGION: props.awsRegion,
                DC_NAME: props.dataCenterName,
                DC_NOMAD_INSTANCE_COUNT: props.instanceCount.toString(10),
                NOMAD_SERVER_TAG_KEY: props.discoveryTagKey,
                NOMAD_SERVER_TAG_VALUE: props.discoveryTagValue,
                NOMAD_HTTP_ENDPOINT: props.lbDnsName,
                NOMAD_RPC_ENDPOINT:props.lbDnsName
            },
            secrets: {
                NOMAD_CA_CERTIFICATE: ecs.Secret.fromSecretsManager(caCertificate),
                NOMAD_SERVER_CERTIFICATE : ecs.Secret.fromSecretsManager(serverCertificate),
                NOMAD_SERVER_PRIVATE_KEY: ecs.Secret.fromSecretsManager(serverPrivateKey),
            },
            logging: new ecs.AwsLogDriver({ 
                streamPrefix: "nomad-server", 
                mode: ecs.AwsLogDriverMode.NON_BLOCKING,
                logRetention: logs.RetentionDays.THREE_DAYS

            }),
            portMappings: [{
                containerPort: 4646
            },{
                containerPort: 4647
            },{
                containerPort: 4648,
                protocol: ecs.Protocol.TCP
            },{
                containerPort: 4648,
                protocol: ecs.Protocol.UDP
            }],
      
        })
    
        // Mounting the EFS filesystem.
        nomadContainer.addMountPoints({
            containerPath: "/opt/nomad/",
            sourceVolume: efsVolumeName,
            readOnly: false
        })

    
        this.service = new ecs.Ec2Service(this, "Service", { 
            cluster:nomadCluster, 
            taskDefinition: nomadTaskDefinition,
            daemon: true,
            enableExecuteCommand: true,
            minHealthyPercent: 0,
            maxHealthyPercent: 100
        })
    
    }   
}