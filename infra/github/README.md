# GitHub Actions deploy role

This repo deploys to AWS following the [aws-github-deploy standard](https://github.com/jakubprzybytek/agent-playbook/blob/main/skills/aws-github-deploy/STANDARD.md).

| | |
|---|---|
| Role | `GitHub-PortfolioTracker` |
| Policies | `SST-Deployment` (shared), `PortfolioTracker-Deployment` (this repo, [deploy-policy.json](deploy-policy.json)) |
| SST app name / resource prefix | `portfolio-tracker` |
| Region | `eu-west-1` (CloudFront certificate in `us-east-1`) |
| Workflows that deploy | `.github/workflows/continuous-delivery.yaml` (job `int`, then `prod` from the release tag) |
| GitHub | secret `AWS_ACCOUNT_ID`, variable `AWS_REGION` |

`deploy-policy.json` has `ACCOUNT_ID` in place of the account number. The rendered policy and the trust policy are in `private/` (gitignored).

## What the project policy covers

The app is an API Gateway (HTTP API) with Lambda handlers and a Cognito authorizer on the shared user pool, EventBridge Scheduler jobs, SQS queues, DynamoDB tables, S3 buckets (site, imports with a bucket notification), an SNS alerts topic with CloudWatch alarms, and a static site on CloudFront.

- `Identity`: `sts:GetCallerIdentity`.
- `SstState`: SST parameters under `/sst/*`.
- `Buckets`: S3 on `portfolio-tracker-*` and the SST asset bucket (`sst-asset-*`).
- `Functions`: Lambda functions `portfolio-tracker-*` and event source mappings.
- `EventSourceMappingsCreate`: creating and listing event source mappings only accepts `Resource: "*"`.
- `Logs`, `ApiAccessLogDelivery`: CloudWatch log groups in eu-west-1; log deliveries for the API's access logs (`Resource: "*"` only).
- `ApiGateway`: API Gateway in eu-west-1.
- `Queues`, `Tables`, `Schedules`, `Alerts`: SQS, DynamoDB, EventBridge Scheduler (any group) and SNS, all `portfolio-tracker-*`.
- `Alarms`: CloudWatch alarms `portfolio-tracker-*` and `Valuation*` (see deviations).
- `Auth`: the app's client on the shared Cognito user pool (`AlbedoUserPool`, read with `CognitoUserPool.get`).
- `Edge`: CloudFront (distribution, function, cache policy, KeyValueStore), ACM and Route 53. Account-wide; these services can't be scoped usefully.
- `Roles`: IAM roles `portfolio-tracker-*` for the functions and schedules.
- `PassRoles`: pass `portfolio-tracker-*` roles to Lambda and EventBridge Scheduler only.

## Deviations from the standard

- **Alarms `Valuation*`.** The two alarms (`ValuationErrors-…`, `ValuationDeadLetterNotEmpty-…`) are raw Pulumi resources without the app prefix. A new alarm needs a `portfolio-tracker-` name, or its name pattern added to `Alarms`.

## Changing the role or policy

From the repo root, with admin credentials (`aws login`):

```sh
~/.claude/skills/aws-github-deploy/scripts/setup-role.sh PortfolioTracker
```

The script is safe to re-run: it renders the documents, publishes a new policy version if the file changed, updates the trust policy and tags, and sets the GitHub secret and variable.

## History

- v5 (2026-10-23) added the SNS alerts topic and CloudWatch alarms; without them the prod deploy failed creating the `Alerts` topic.
- v6 (2026-10-26) moved to the standard: Lambda, DynamoDB, S3, Scheduler and IAM scoped to `portfolio-tracker-*` (they were on `*`), `iam:PassRole` limited by service, EventBridge and `iam:CreateServiceLinkedRole` removed (unused). The trust dropped the classic subject form, the jobs no longer use GitHub environments, the secret `AWS_ACCOUNT` became `AWS_ACCOUNT_ID`, and the role's maximum session went from 2 hours to 1.
