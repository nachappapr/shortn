# Learning environment

A single Terraform environment used across the curriculum. Each module's
AWS Stage 5 adds modules to this env, applies them, exercises them, and
tears them down before the session closes.

State is local (no S3 backend) because this env is destroyed regularly.
For real production you'd never do this.

## Apply / destroy

```bash
cd infra/terraform/envs/learning
terraform init
terraform plan
terraform apply
# ...do the exercise...
terraform destroy
```

## Verify teardown

```bash
aws ec2 describe-instances --filters "Name=instance-state-name,Values=running"
aws rds describe-db-instances
aws elasticache describe-cache-clusters
aws elbv2 describe-load-balancers
aws sqs list-queues
# Check Cost Explorer next morning. Zero new charges.
```
