#!/usr/bin/env node
import "source-map-support/register"
import * as cdk from "aws-cdk-lib"
import { AcmPcaStack } from "../lib/acm-pca-stack"
import { IamAnyStack } from "../lib/iam-any-stack"
import {NomadInfrastructureStack} from "../lib/nomad-infrastructure-stack"
import deploymentProps from "../deployment.json"
import { Aspects } from "aws-cdk-lib"
import { AwsSolutionsChecks } from "cdk-nag"

const app = new cdk.App()
const caStack = new AcmPcaStack(app, "AcmPcaStack",{
    env : {
        account: process.env.CDK_DEFAULT_ACCOUNT,
        region : process.env.CDK_DEFAULT_REGION
    },
    nomadRegion: deploymentProps.cluster.nomad_region
})
new IamAnyStack(app, "IamAnyStack", {
    env : {
        account: process.env.CDK_DEFAULT_ACCOUNT,
        region : process.env.CDK_DEFAULT_REGION
    },
    acmPcaArn: caStack.caArn
})

const randomPrefix = Math.floor(Math.random()*1000000000)
const prefix = `cluster-${randomPrefix}`

new NomadInfrastructureStack(app, "NomadInfrastructureStack", {
    // define region and account so the VPC construct will use all AZs in a given region
    env : {
        account: process.env.CDK_DEFAULT_ACCOUNT,
        region : process.env.CDK_DEFAULT_REGION
    },
    cluster: {
        instanceCount: deploymentProps.cluster.instance_count,
        nomadRegion: deploymentProps.cluster.nomad_region,
        awsRegion: process.env.CDK_DEFAULT_REGION || "undefined",
        dataCenterName: deploymentProps.cluster.datacenter_name,
        discoveryTagKey: deploymentProps.cluster.discovery_tag_key,
        discoveryTagValue: deploymentProps.cluster.discovery_tag_value,
    },
    certificates: {
        caCertSecretName: deploymentProps.certificates.ca_cert_secret_name,
        serverCertSecretName: deploymentProps.certificates.server_cert_secret_name,
        serverPrivateKeySecretName: deploymentProps.certificates.server_private_key_secret_name,
    },
    ingress: {
        lbPrefix: prefix
    },
    authentication: {
        userName: deploymentProps.authentication.username,
        userEmail:  deploymentProps.authentication.email,
        domainPrefix: deploymentProps.authentication.domain_prefix,
    }
})


Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }))