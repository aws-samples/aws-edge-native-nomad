import {  Stack, StackProps } from "aws-cdk-lib"
import { Construct } from "constructs"

import {Network} from "./constructs/network"
import {Ingress} from "./constructs/ingress"
import {Cluster} from "./constructs/cluster"
import {NomadAcl} from "./constructs/nomad-acl"
import {Authentication} from "./constructs/authentication"

export interface ClusterProps {

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
   * the number of nomad server participating to the cluster
   */
  readonly instanceCount: number

  /**
   * the name of the data center hosting the cluster of nomad server
   */
  readonly dataCenterName: string


  
}

export interface CertificatesProps {
  /**
   * the name of the secret storing the CA certificate
   */
  readonly caCertSecretName: string
  
  /**
   * the name of the secret storing the nomad server certificate
   */
  readonly serverCertSecretName: string
  
  /**
   * the name of the secret storing the nomad server certificate
   */
  readonly serverPrivateKeySecretName: string

}

export interface AuthenticationProps {
  /**
   *  The name of the nomad user
   */
  readonly userName: string
  /**
   *  The email associated with the nomad user
   */
  readonly userEmail: string

  /**
   *  The Amazon Cognito domain prefix - https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pools-assign-domain-prefix.html
   */
  readonly domainPrefix: string

}

export interface IngressProps {
  /**
   *  The prefix used for the LB name
   */
  readonly lbPrefix: string

}





export interface NomadInfrastructureStackProps extends StackProps {
  /**
   * properties related to the nomad cluster
   */ 
  cluster: ClusterProps 
  
  /**
   * properties related to the certificates management
   */ 
  certificates: CertificatesProps

  /**
   * properties related to the ingress endpoint
   */
  ingress: IngressProps

  /**
   * properties related to  nomad user
   */
  authentication: AuthenticationProps

}
  
  
export class NomadInfrastructureStack extends Stack {
    constructor(scope: Construct, id: string, props: NomadInfrastructureStackProps) {
        super(scope, id, props)


    
        /**
         * Networking section
         */
        const nomadNetwork = new Network(this,"Network")
        const nomadVpc = nomadNetwork.vpc
    

        /**
         * Endpoint section
         */
        const ingress = new Ingress(this,"Ingress",{
            nomadVpc,
            lbPrefix: props.ingress.lbPrefix
        })
    
    
        /**
         * compute resource section
         */
        const cluster = new Cluster(this,"Cluster",{
            nomadVpc,
            lbDnsName : ingress.lbDnsName,
            ...props.cluster,
            ...props.certificates
        })
    
        /**
         * forward trafic to the load balancer
         */
        ingress.updateListener(cluster.service)

        const auth = new Authentication(this,"Authentication",{
            clusterDns: ingress.lbDnsName,
            ...props.authentication

        })
    
        /**
         * Managegment of nomad ACL
         */
        const nomadAcl = new NomadAcl(this,"Acl",{
            caCertSecretName: props.certificates.caCertSecretName,
            nomadDnsName: ingress.lbDnsName,
            oidcClientId: auth.oidcClientId,
            oidcClientSecret: auth.oidcClientSecret,
            oidcDiscoveryURL: auth.oidcDiscoveryUrl
        })

        nomadAcl.node.addDependency(cluster)
    
    }
}
