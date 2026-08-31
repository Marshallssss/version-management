using ConfigHub.Infrastructure.Persistence.Entities;
using Microsoft.EntityFrameworkCore;

namespace ConfigHub.Infrastructure.Persistence;

internal static class ConfigHubModel
{
    public static void Configure(ModelBuilder modelBuilder)
    {
        modelBuilder.HasPostgresExtension("btree_gist");

        modelBuilder.Entity<ApplicationUser>(entity =>
        {
            entity.Property(user => user.DisplayName).HasColumnName("display_name").HasMaxLength(160);
        });

        modelBuilder.Entity<IdempotencyRecord>(entity =>
        {
            entity.ToTable("idempotency_records");
            entity.HasKey(record => record.Id);
            entity.Property(record => record.Id).HasColumnName("id");
            entity.Property(record => record.Scope).HasColumnName("scope").HasMaxLength(160);
            entity.Property(record => record.IdempotencyKey).HasColumnName("idempotency_key").HasMaxLength(200);
            entity.Property(record => record.RequestHash).HasColumnName("request_hash").HasMaxLength(128);
            entity.Property(record => record.Status)
                .HasColumnName("status")
                .HasMaxLength(32)
                .HasConversion<string>();
            entity.Property(record => record.Result).HasColumnName("result").HasColumnType("jsonb");
            entity.Property(record => record.Reference).HasColumnName("reference").HasMaxLength(500);
            entity.Property(record => record.CreatedAt).HasColumnName("created_at");
            entity.Property(record => record.ExpiresAt).HasColumnName("expires_at");
            entity.HasIndex(record => new { record.Scope, record.IdempotencyKey })
                .IsUnique()
                .HasDatabaseName("ux_idempotency_records_scope_key");
            entity.HasIndex(record => record.ExpiresAt)
                .HasDatabaseName("ix_idempotency_records_expires_at");
        });

        modelBuilder.Entity<BackgroundJob>(entity =>
        {
            entity.ToTable("background_jobs");
            entity.HasKey(job => job.Id);
            entity.Property(job => job.Id).HasColumnName("id");
            entity.Property(job => job.JobType).HasColumnName("job_type").HasMaxLength(160);
            entity.Property(job => job.Payload).HasColumnName("payload").HasColumnType("jsonb");
            entity.Property(job => job.Status)
                .HasColumnName("status")
                .HasMaxLength(32)
                .HasConversion<string>();
            entity.Property(job => job.AvailableAt).HasColumnName("available_at");
            entity.Property(job => job.LockedAt).HasColumnName("locked_at");
              entity.Property(job => job.LockedBy).HasColumnName("locked_by").HasMaxLength(240);
              entity.Property(job => job.Attempts).HasColumnName("attempts");
              entity.Property(job => job.LastAttemptAt).HasColumnName("last_attempt_at");
              entity.Property(job => job.CreatedAt).HasColumnName("created_at");
            entity.Property(job => job.CompletedAt).HasColumnName("completed_at");
            entity.Property(job => job.LastError).HasColumnName("last_error").HasMaxLength(4000);
            entity.HasIndex(job => new { job.Status, job.AvailableAt })
                .HasDatabaseName("ix_background_jobs_claim");
            entity.HasIndex(job => job.CreatedAt)
                .HasDatabaseName("ix_background_jobs_created_at");
        });

        modelBuilder.Entity<Project>(entity =>
        {
            entity.ToTable("projects");
            entity.HasKey(project => project.Id);
            entity.Property(project => project.Id).HasColumnName("id");
            entity.Property(project => project.Code).HasColumnName("code").HasMaxLength(50);
            entity.Property(project => project.NormalizedCode).HasColumnName("normalized_code").HasMaxLength(50);
            entity.Property(project => project.Name).HasColumnName("name").HasMaxLength(200);
            entity.Property(project => project.Description).HasColumnName("description").HasMaxLength(2000);
            entity.Property(project => project.Status).HasColumnName("status").HasMaxLength(32).HasConversion<string>();
            entity.Property(project => project.CreatedAt).HasColumnName("created_at");
            entity.Property(project => project.UpdatedAt).HasColumnName("updated_at");
            entity.HasIndex(project => project.NormalizedCode).IsUnique().HasDatabaseName("ux_projects_normalized_code");
            entity.HasIndex(project => project.Status).HasDatabaseName("ix_projects_status");
        });

        modelBuilder.Entity<ProjectMembership>(entity =>
        {
            entity.ToTable("project_memberships");
            entity.HasKey(membership => membership.Id);
            entity.Property(membership => membership.Id).HasColumnName("id");
            entity.Property(membership => membership.ProjectId).HasColumnName("project_id");
            entity.Property(membership => membership.UserId).HasColumnName("user_id");
            entity.Property(membership => membership.Role).HasColumnName("role").HasMaxLength(32).HasConversion<string>();
            entity.Property(membership => membership.AssignedBy).HasColumnName("assigned_by").HasMaxLength(160);
            entity.Property(membership => membership.Reason).HasColumnName("reason").HasMaxLength(500);
            entity.Property(membership => membership.AssignedAt).HasColumnName("assigned_at");
            entity.HasIndex(membership => new { membership.ProjectId, membership.UserId }).IsUnique().HasDatabaseName("ux_project_memberships_project_user");
            entity.HasIndex(membership => membership.UserId).HasDatabaseName("ix_project_memberships_user");
            entity.HasOne<Project>().WithMany().HasForeignKey(membership => membership.ProjectId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<ApplicationUser>().WithMany().HasForeignKey(membership => membership.UserId).OnDelete(DeleteBehavior.Restrict);
        });

        modelBuilder.Entity<ConfigurationComponent>(entity =>
        {
            entity.ToTable("configuration_components");
            entity.HasKey(component => component.Id);
            entity.Property(component => component.Id).HasColumnName("id");
            entity.Property(component => component.ProjectId).HasColumnName("project_id");
            entity.Property(component => component.ParentComponentId).HasColumnName("parent_component_id");
            entity.Property(component => component.ComponentCode).HasColumnName("component_code").HasMaxLength(80);
            entity.Property(component => component.NormalizedComponentCode).HasColumnName("normalized_component_code").HasMaxLength(80);
            entity.Property(component => component.LineageKey).HasColumnName("lineage_key").HasMaxLength(1000);
            entity.Property(component => component.Name).HasColumnName("name").HasMaxLength(200);
            entity.Property(component => component.SortOrder).HasColumnName("sort_order");
            entity.Property(component => component.CreatedAt).HasColumnName("created_at");
            entity.HasIndex(component => new { component.ProjectId, component.NormalizedComponentCode })
                .IsUnique().HasDatabaseName("ux_components_project_code");
            entity.HasIndex(component => new { component.ProjectId, component.LineageKey })
                .IsUnique().HasDatabaseName("ux_components_project_lineage");
            entity.HasIndex(component => new { component.ProjectId, component.ParentComponentId, component.SortOrder })
                .HasDatabaseName("ix_components_project_parent_sort");
            entity.HasOne<Project>().WithMany().HasForeignKey(component => component.ProjectId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<ConfigurationComponent>().WithMany().HasForeignKey(component => component.ParentComponentId).OnDelete(DeleteBehavior.Restrict);
        });

        modelBuilder.Entity<ComponentVersion>(entity =>
        {
            entity.ToTable("component_versions");
            entity.HasKey(version => version.Id);
            entity.Property(version => version.Id).HasColumnName("id");
            entity.Property(version => version.ComponentId).HasColumnName("component_id");
            entity.Property(version => version.VersionNumber).HasColumnName("version_number").HasMaxLength(160);
            entity.Property(version => version.NormalizedVersionNumber).HasColumnName("normalized_version_number").HasMaxLength(160);
            entity.Property(version => version.SequenceNo).HasColumnName("sequence_no");
            entity.Property(version => version.Maturity).HasColumnName("maturity").HasMaxLength(32).HasConversion<string>();
            entity.Property(version => version.Safety).HasColumnName("safety").HasMaxLength(32).HasConversion<string>();
            entity.Property(version => version.CreatedAt).HasColumnName("created_at");
            entity.HasIndex(version => new { version.ComponentId, version.NormalizedVersionNumber })
                .IsUnique().HasDatabaseName("ux_component_versions_normalized_number");
            entity.HasIndex(version => new { version.ComponentId, version.SequenceNo })
                .IsUnique().HasDatabaseName("ux_component_versions_sequence_no");
            entity.HasOne<ConfigurationComponent>().WithMany().HasForeignKey(version => version.ComponentId).OnDelete(DeleteBehavior.Restrict);
        });

        modelBuilder.Entity<AuditEvent>(entity =>
        {
            entity.ToTable("audit_events");
            entity.HasKey(auditEvent => auditEvent.Id);
            entity.Property(auditEvent => auditEvent.Id).HasColumnName("id");
            entity.Property(auditEvent => auditEvent.Actor).HasColumnName("actor").HasMaxLength(160);
            entity.Property(auditEvent => auditEvent.Action).HasColumnName("action").HasMaxLength(120);
            entity.Property(auditEvent => auditEvent.EntityType).HasColumnName("entity_type").HasMaxLength(120);
            entity.Property(auditEvent => auditEvent.EntityId).HasColumnName("entity_id");
            entity.Property(auditEvent => auditEvent.CorrelationId).HasColumnName("correlation_id").HasMaxLength(128);
            entity.Property(auditEvent => auditEvent.Data).HasColumnName("data").HasColumnType("jsonb");
            entity.Property(auditEvent => auditEvent.OccurredAt).HasColumnName("occurred_at");
            entity.HasIndex(auditEvent => new { auditEvent.EntityType, auditEvent.EntityId, auditEvent.OccurredAt })
                .HasDatabaseName("ix_audit_events_entity_occurred_at");
            entity.HasIndex(auditEvent => auditEvent.CorrelationId).HasDatabaseName("ix_audit_events_correlation_id");
        });

        modelBuilder.Entity<VersionLifecycleTransition>(entity =>
        {
            entity.ToTable("version_lifecycle_transitions");
            entity.HasKey(transition => transition.Id);
            entity.Property(transition => transition.Id).HasColumnName("id");
            entity.Property(transition => transition.ComponentVersionId).HasColumnName("component_version_id");
            entity.Property(transition => transition.Axis).HasColumnName("axis").HasMaxLength(32).HasConversion<string>();
            entity.Property(transition => transition.FromState).HasColumnName("from_state").HasMaxLength(32);
            entity.Property(transition => transition.ToState).HasColumnName("to_state").HasMaxLength(32);
            entity.Property(transition => transition.Reason).HasColumnName("reason").HasMaxLength(500);
            entity.Property(transition => transition.Actor).HasColumnName("actor").HasMaxLength(160);
            entity.Property(transition => transition.OccurredAt).HasColumnName("occurred_at");
            entity.HasIndex(transition => new { transition.ComponentVersionId, transition.OccurredAt }).HasDatabaseName("ix_version_lifecycle_transitions_version_occurred_at");
            entity.HasOne<ComponentVersion>().WithMany().HasForeignKey(transition => transition.ComponentVersionId).OnDelete(DeleteBehavior.Restrict);
        });

        modelBuilder.Entity<VersionRecommendation>(entity =>
        {
            entity.ToTable("version_recommendations");
            entity.HasKey(recommendation => recommendation.Id);
            entity.Property(recommendation => recommendation.Id).HasColumnName("id");
            entity.Property(recommendation => recommendation.ComponentId).HasColumnName("component_id");
            entity.Property(recommendation => recommendation.ComponentVersionId).HasColumnName("component_version_id");
            entity.Property(recommendation => recommendation.AssignedBy).HasColumnName("assigned_by").HasMaxLength(160);
            entity.Property(recommendation => recommendation.Reason).HasColumnName("reason").HasMaxLength(500);
            entity.Property(recommendation => recommendation.AssignedAt).HasColumnName("assigned_at");
            entity.Property(recommendation => recommendation.RevokedAt).HasColumnName("revoked_at");
            entity.Property(recommendation => recommendation.RevokedBy).HasColumnName("revoked_by").HasMaxLength(160);
            entity.Property(recommendation => recommendation.RevokeReason).HasColumnName("revoke_reason").HasMaxLength(500);
            entity.HasIndex(recommendation => recommendation.ComponentId).IsUnique().HasFilter("revoked_at IS NULL").HasDatabaseName("ux_version_recommendations_active_component");
            entity.HasOne<ConfigurationComponent>().WithMany().HasForeignKey(recommendation => recommendation.ComponentId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<ComponentVersion>().WithMany().HasForeignKey(recommendation => recommendation.ComponentVersionId).OnDelete(DeleteBehavior.Restrict);
        });

        modelBuilder.Entity<BaselineSeries>(entity =>
        {
            entity.ToTable("baseline_series");
            entity.HasKey(series => series.Id);
            entity.Property(series => series.Id).HasColumnName("id");
            entity.Property(series => series.ProjectId).HasColumnName("project_id");
            entity.Property(series => series.SeriesCode).HasColumnName("series_code").HasMaxLength(80);
            entity.Property(series => series.NormalizedSeriesCode).HasColumnName("normalized_series_code").HasMaxLength(80);
            entity.Property(series => series.CreatedAt).HasColumnName("created_at");
            entity.HasIndex(series => new { series.ProjectId, series.NormalizedSeriesCode }).IsUnique().HasDatabaseName("ux_baseline_series_project_code");
            entity.HasOne<Project>().WithMany().HasForeignKey(series => series.ProjectId).OnDelete(DeleteBehavior.Restrict);
        });

        modelBuilder.Entity<ConfigurationBaseline>(entity =>
        {
            entity.ToTable("configuration_baselines");
            entity.HasKey(baseline => baseline.Id);
            entity.Property(baseline => baseline.Id).HasColumnName("id");
            entity.Property(baseline => baseline.ProjectId).HasColumnName("project_id");
            entity.Property(baseline => baseline.BaselineSeriesId).HasColumnName("baseline_series_id");
            entity.Property(baseline => baseline.SupersedesBaselineId).HasColumnName("supersedes_baseline_id");
            entity.Property(baseline => baseline.TopComponentVersionId).HasColumnName("top_component_version_id");
            entity.Property(baseline => baseline.BaselineCode).HasColumnName("baseline_code").HasMaxLength(100);
            entity.Property(baseline => baseline.NormalizedBaselineCode).HasColumnName("normalized_baseline_code").HasMaxLength(100);
            entity.Property(baseline => baseline.RevisionNo).HasColumnName("revision_no");
            entity.Property(baseline => baseline.Description).HasColumnName("description").HasMaxLength(2000);
            entity.Property(baseline => baseline.State).HasColumnName("state").HasMaxLength(32).HasConversion<string>();
            entity.Property(baseline => baseline.CreatedBy).HasColumnName("created_by").HasMaxLength(160);
            entity.Property(baseline => baseline.CreatedAt).HasColumnName("created_at");
            entity.Property(baseline => baseline.ReleasedBy).HasColumnName("released_by").HasMaxLength(160);
            entity.Property(baseline => baseline.ReleasedAt).HasColumnName("released_at");
            entity.Property(baseline => baseline.ReleaseReason).HasColumnName("release_reason").HasMaxLength(500);
            entity.Property(baseline => baseline.ApprovedBy).HasColumnName("approved_by").HasMaxLength(160);
            entity.HasIndex(baseline => new { baseline.ProjectId, baseline.NormalizedBaselineCode }).IsUnique().HasDatabaseName("ux_configuration_baselines_project_code");
            entity.HasIndex(baseline => new { baseline.BaselineSeriesId, baseline.RevisionNo }).IsUnique().HasDatabaseName("ux_configuration_baselines_series_revision");
            entity.HasIndex(baseline => baseline.TopComponentVersionId).HasDatabaseName("ix_configuration_baselines_top_version");
            entity.HasOne<Project>().WithMany().HasForeignKey(baseline => baseline.ProjectId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<BaselineSeries>().WithMany().HasForeignKey(baseline => baseline.BaselineSeriesId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<ConfigurationBaseline>().WithMany().HasForeignKey(baseline => baseline.SupersedesBaselineId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<ComponentVersion>().WithMany().HasForeignKey(baseline => baseline.TopComponentVersionId).OnDelete(DeleteBehavior.Restrict);
        });

        modelBuilder.Entity<BaselineItem>(entity =>
        {
            entity.ToTable("baseline_items");
            entity.HasKey(item => item.Id);
            entity.Property(item => item.Id).HasColumnName("id");
            entity.Property(item => item.ConfigurationBaselineId).HasColumnName("configuration_baseline_id");
            entity.Property(item => item.ConfigurationComponentId).HasColumnName("configuration_component_id");
            entity.Property(item => item.ComponentVersionId).HasColumnName("component_version_id");
            entity.Property(item => item.VersionNumberSnapshot).HasColumnName("version_number_snapshot").HasMaxLength(200);
            entity.Property(item => item.ParentBaselineItemId).HasColumnName("parent_baseline_item_id");
            entity.Property(item => item.ComponentCodeSnapshot).HasColumnName("component_code_snapshot").HasMaxLength(80);
            entity.Property(item => item.ComponentNameSnapshot).HasColumnName("component_name_snapshot").HasMaxLength(200);
            entity.Property(item => item.LineageKeySnapshot).HasColumnName("lineage_key_snapshot").HasMaxLength(1000);
            entity.Property(item => item.SortOrder).HasColumnName("sort_order");
            entity.Property(item => item.Requirement).HasColumnName("requirement").HasMaxLength(32).HasConversion<string>();
            entity.HasIndex(item => new { item.ConfigurationBaselineId, item.ConfigurationComponentId }).IsUnique().HasDatabaseName("ux_baseline_items_baseline_component");
            entity.HasIndex(item => item.ComponentVersionId).HasDatabaseName("ix_baseline_items_version");
            entity.HasIndex(item => new { item.ConfigurationBaselineId, item.ParentBaselineItemId, item.SortOrder }).HasDatabaseName("ix_baseline_items_baseline_parent_sort");
            entity.HasOne<ConfigurationBaseline>().WithMany().HasForeignKey(item => item.ConfigurationBaselineId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<ConfigurationComponent>().WithMany().HasForeignKey(item => item.ConfigurationComponentId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<ComponentVersion>().WithMany().HasForeignKey(item => item.ComponentVersionId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<BaselineItem>().WithMany().HasForeignKey(item => item.ParentBaselineItemId).OnDelete(DeleteBehavior.Restrict);
        });

        modelBuilder.Entity<BaselineLifecycleTransition>(entity =>
        {
            entity.ToTable("baseline_lifecycle_transitions");
            entity.HasKey(transition => transition.Id);
            entity.Property(transition => transition.Id).HasColumnName("id");
            entity.Property(transition => transition.ConfigurationBaselineId).HasColumnName("configuration_baseline_id");
            entity.Property(transition => transition.FromState).HasColumnName("from_state").HasMaxLength(32);
            entity.Property(transition => transition.ToState).HasColumnName("to_state").HasMaxLength(32);
            entity.Property(transition => transition.Reason).HasColumnName("reason").HasMaxLength(500);
            entity.Property(transition => transition.Actor).HasColumnName("actor").HasMaxLength(160);
            entity.Property(transition => transition.OccurredAt).HasColumnName("occurred_at");
            entity.HasIndex(transition => new { transition.ConfigurationBaselineId, transition.OccurredAt }).HasDatabaseName("ix_baseline_lifecycle_transitions_baseline_occurred_at");
            entity.HasOne<ConfigurationBaseline>().WithMany().HasForeignKey(transition => transition.ConfigurationBaselineId).OnDelete(DeleteBehavior.Restrict);
        });

        modelBuilder.Entity<BaselineReview>(entity =>
        {
            entity.ToTable("baseline_reviews");
            entity.HasKey(review => review.Id);
            entity.Property(review => review.Id).HasColumnName("id");
            entity.Property(review => review.ConfigurationBaselineId).HasColumnName("configuration_baseline_id");
            entity.Property(review => review.Status).HasColumnName("status").HasMaxLength(32).HasConversion<string>();
            entity.Property(review => review.RequestedBy).HasColumnName("requested_by").HasMaxLength(160);
            entity.Property(review => review.RequestedAt).HasColumnName("requested_at");
            entity.Property(review => review.RequestReason).HasColumnName("request_reason").HasMaxLength(500);
            entity.Property(review => review.DecidedBy).HasColumnName("decided_by").HasMaxLength(160);
            entity.Property(review => review.DecidedAt).HasColumnName("decided_at");
            entity.Property(review => review.DecisionReason).HasColumnName("decision_reason").HasMaxLength(500);
            entity.HasIndex(review => new { review.ConfigurationBaselineId, review.RequestedAt }).HasDatabaseName("ix_baseline_reviews_baseline_requested_at");
            entity.HasIndex(review => review.ConfigurationBaselineId).IsUnique().HasFilter("status = 'Pending'").HasDatabaseName("ux_baseline_reviews_pending_baseline");
            entity.HasOne<ConfigurationBaseline>().WithMany().HasForeignKey(review => review.ConfigurationBaselineId).OnDelete(DeleteBehavior.Restrict);
        });

        modelBuilder.Entity<ProjectStandardAssignment>(entity =>
        {
            entity.ToTable("project_standard_assignments");
            entity.HasKey(assignment => assignment.Id);
            entity.Property(assignment => assignment.Id).HasColumnName("id");
            entity.Property(assignment => assignment.ProjectId).HasColumnName("project_id");
            entity.Property(assignment => assignment.ConfigurationBaselineId).HasColumnName("configuration_baseline_id");
            entity.Property(assignment => assignment.ValidFrom).HasColumnName("valid_from");
            entity.Property(assignment => assignment.ValidTo).HasColumnName("valid_to");
            entity.Property(assignment => assignment.AssignedBy).HasColumnName("assigned_by").HasMaxLength(160);
            entity.Property(assignment => assignment.Reason).HasColumnName("reason").HasMaxLength(500);
            entity.HasIndex(assignment => assignment.ProjectId).IsUnique().HasFilter("valid_to IS NULL").HasDatabaseName("ux_project_standard_assignments_current_project");
            entity.HasOne<Project>().WithMany().HasForeignKey(assignment => assignment.ProjectId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<ConfigurationBaseline>().WithMany().HasForeignKey(assignment => assignment.ConfigurationBaselineId).OnDelete(DeleteBehavior.Restrict);
        });
        modelBuilder.Entity<Machine>(entity =>
        {
            entity.ToTable("machines"); entity.HasKey(machine => machine.Id);
            entity.Property(machine => machine.Id).HasColumnName("id"); entity.Property(machine => machine.ProjectId).HasColumnName("project_id");
            entity.Property(machine => machine.SerialNumber).HasColumnName("serial_number").HasMaxLength(160);
            entity.Property(machine => machine.NormalizedSerialNumber).HasColumnName("normalized_serial_number").HasMaxLength(160);
            entity.Property(machine => machine.Name).HasColumnName("name").HasMaxLength(200); entity.Property(machine => machine.MachineType).HasColumnName("machine_type").HasMaxLength(120);
            entity.Property(machine => machine.Status).HasColumnName("status").HasMaxLength(32).HasConversion<string>(); entity.Property(machine => machine.CreatedAt).HasColumnName("created_at");
            entity.HasIndex(machine => machine.NormalizedSerialNumber).IsUnique().HasDatabaseName("ux_machines_normalized_serial");
            entity.HasIndex(machine => new { machine.ProjectId, machine.Status, machine.MachineType }).HasDatabaseName("ix_machines_project_status_type");
            entity.HasOne<Project>().WithMany().HasForeignKey(machine => machine.ProjectId).OnDelete(DeleteBehavior.Restrict);
        });
        modelBuilder.Entity<MachineTargetAssignment>(entity =>
        {
            entity.ToTable("machine_target_assignments"); entity.HasKey(item => item.Id);
            entity.Property(item => item.Id).HasColumnName("id"); entity.Property(item => item.MachineId).HasColumnName("machine_id"); entity.Property(item => item.ConfigurationBaselineId).HasColumnName("configuration_baseline_id");
            entity.Property(item => item.ValidFrom).HasColumnName("valid_from"); entity.Property(item => item.ValidTo).HasColumnName("valid_to"); entity.Property(item => item.AssignedBy).HasColumnName("assigned_by").HasMaxLength(160); entity.Property(item => item.Reason).HasColumnName("reason").HasMaxLength(500);
            entity.HasIndex(item => item.MachineId).IsUnique().HasFilter("valid_to IS NULL").HasDatabaseName("ux_machine_target_assignments_current_machine");
            entity.HasOne<Machine>().WithMany().HasForeignKey(item => item.MachineId).OnDelete(DeleteBehavior.Restrict); entity.HasOne<ConfigurationBaseline>().WithMany().HasForeignKey(item => item.ConfigurationBaselineId).OnDelete(DeleteBehavior.Restrict);
        });
        modelBuilder.Entity<DeploymentBatch>(entity =>
        {
            entity.ToTable("deployment_batches"); entity.HasKey(item => item.Id);
            entity.Property(item => item.Id).HasColumnName("id"); entity.Property(item => item.MachineId).HasColumnName("machine_id");
            entity.Property(item => item.OperationType).HasColumnName("operation_type").HasMaxLength(32).HasConversion<string>(); entity.Property(item => item.Coverage).HasColumnName("coverage").HasMaxLength(32).HasConversion<string>();
            entity.Property(item => item.SourceType).HasColumnName("source_type").HasMaxLength(80); entity.Property(item => item.ExternalEventId).HasColumnName("external_event_id").HasMaxLength(200); entity.Property(item => item.CorrectsDeploymentBatchId).HasColumnName("corrects_deployment_batch_id"); entity.Property(item => item.RecordedAt).HasColumnName("recorded_at"); entity.Property(item => item.EffectiveAt).HasColumnName("effective_at");
            entity.HasIndex(item => new { item.MachineId, item.EffectiveAt }).HasDatabaseName("ix_deployment_batches_machine_effective_at"); entity.HasIndex(item => new { item.SourceType, item.ExternalEventId }).IsUnique().HasFilter("external_event_id IS NOT NULL").HasDatabaseName("ux_deployment_batches_source_event"); entity.HasOne<Machine>().WithMany().HasForeignKey(item => item.MachineId).OnDelete(DeleteBehavior.Restrict);
            entity.HasIndex(item => item.CorrectsDeploymentBatchId).HasDatabaseName("ix_deployment_batches_corrects_batch"); entity.HasOne<DeploymentBatch>().WithMany().HasForeignKey(item => item.CorrectsDeploymentBatchId).OnDelete(DeleteBehavior.Restrict);
        });
        modelBuilder.Entity<DeploymentItem>(entity =>
        {
            entity.ToTable("deployment_items"); entity.HasKey(item => item.Id);
            entity.Property(item => item.Id).HasColumnName("id"); entity.Property(item => item.DeploymentBatchId).HasColumnName("deployment_batch_id"); entity.Property(item => item.ConfigurationComponentId).HasColumnName("configuration_component_id"); entity.Property(item => item.NewComponentVersionId).HasColumnName("new_component_version_id"); entity.Property(item => item.Result).HasColumnName("result").HasMaxLength(32).HasConversion<string>(); entity.Property(item => item.KnownInstalledAt).HasColumnName("known_installed_at");
            entity.HasIndex(item => new { item.DeploymentBatchId, item.ConfigurationComponentId }).IsUnique().HasDatabaseName("ux_deployment_items_batch_component"); entity.HasIndex(item => new { item.NewComponentVersionId, item.Result }).HasDatabaseName("ix_deployment_items_version_result");
            entity.HasOne<DeploymentBatch>().WithMany().HasForeignKey(item => item.DeploymentBatchId).OnDelete(DeleteBehavior.Restrict); entity.HasOne<ConfigurationComponent>().WithMany().HasForeignKey(item => item.ConfigurationComponentId).OnDelete(DeleteBehavior.Restrict); entity.HasOne<ComponentVersion>().WithMany().HasForeignKey(item => item.NewComponentVersionId).OnDelete(DeleteBehavior.Restrict);
        });
        modelBuilder.Entity<MachineCurrentConfiguration>(entity =>
        {
            entity.ToTable("machine_current_configurations"); entity.HasKey(item => new { item.MachineId, item.ConfigurationComponentId });
            entity.Property(item => item.MachineId).HasColumnName("machine_id"); entity.Property(item => item.ConfigurationComponentId).HasColumnName("configuration_component_id"); entity.Property(item => item.ComponentVersionId).HasColumnName("component_version_id"); entity.Property(item => item.State).HasColumnName("state").HasMaxLength(32).HasConversion<string>(); entity.Property(item => item.StateEffectiveAt).HasColumnName("state_effective_at"); entity.Property(item => item.KnownInstalledAt).HasColumnName("known_installed_at"); entity.Property(item => item.SourceDeploymentItemId).HasColumnName("source_deployment_item_id");
            entity.HasIndex(item => new { item.ComponentVersionId, item.MachineId }).HasDatabaseName("ix_machine_current_configurations_version_machine"); entity.HasOne<Machine>().WithMany().HasForeignKey(item => item.MachineId).OnDelete(DeleteBehavior.Restrict); entity.HasOne<ConfigurationComponent>().WithMany().HasForeignKey(item => item.ConfigurationComponentId).OnDelete(DeleteBehavior.Restrict); entity.HasOne<ComponentVersion>().WithMany().HasForeignKey(item => item.ComponentVersionId).OnDelete(DeleteBehavior.Restrict); entity.HasOne<DeploymentItem>().WithMany().HasForeignKey(item => item.SourceDeploymentItemId).OnDelete(DeleteBehavior.Restrict);
        });
        modelBuilder.Entity<MachineDriftSummary>(entity =>
        {
            entity.ToTable("machine_drift_summaries");
            entity.HasKey(item => item.MachineId);
            entity.Property(item => item.MachineId).HasColumnName("machine_id");
            entity.Property(item => item.MatchStatus).HasColumnName("match_status").HasMaxLength(32).HasConversion<string>();
            entity.Property(item => item.RiskSeverity).HasColumnName("risk_severity").HasMaxLength(32).HasConversion<string>();
            entity.Property(item => item.CalculatedAt).HasColumnName("calculated_at");
            entity.HasOne<Machine>().WithMany().HasForeignKey(item => item.MachineId).OnDelete(DeleteBehavior.Restrict);
        });
        modelBuilder.Entity<BulkOperation>(entity =>
        {
            entity.ToTable("bulk_operations"); entity.HasKey(item => item.Id);
            entity.Property(item => item.Id).HasColumnName("id"); entity.Property(item => item.ProjectId).HasColumnName("project_id"); entity.Property(item => item.OperationType).HasColumnName("operation_type").HasMaxLength(64).HasConversion<string>(); entity.Property(item => item.Status).HasColumnName("status").HasMaxLength(32).HasConversion<string>(); entity.Property(item => item.RequestedBy).HasColumnName("requested_by").HasMaxLength(160); entity.Property(item => item.Reason).HasColumnName("reason").HasMaxLength(500); entity.Property(item => item.RequestedAt).HasColumnName("requested_at"); entity.Property(item => item.CompletedAt).HasColumnName("completed_at");
            entity.HasIndex(item => new { item.ProjectId, item.RequestedAt }).HasDatabaseName("ix_bulk_operations_project_requested_at"); entity.HasOne<Project>().WithMany().HasForeignKey(item => item.ProjectId).OnDelete(DeleteBehavior.Restrict);
        });
        modelBuilder.Entity<BulkOperationItem>(entity =>
        {
            entity.ToTable("bulk_operation_items"); entity.HasKey(item => item.Id);
            entity.Property(item => item.Id).HasColumnName("id"); entity.Property(item => item.BulkOperationId).HasColumnName("bulk_operation_id"); entity.Property(item => item.MachineId).HasColumnName("machine_id"); entity.Property(item => item.Status).HasColumnName("status").HasMaxLength(32).HasConversion<string>(); entity.Property(item => item.Detail).HasColumnName("detail").HasMaxLength(500);
            entity.HasIndex(item => new { item.BulkOperationId, item.MachineId }).IsUnique().HasDatabaseName("ux_bulk_operation_items_operation_machine"); entity.HasOne<BulkOperation>().WithMany().HasForeignKey(item => item.BulkOperationId).OnDelete(DeleteBehavior.Restrict); entity.HasOne<Machine>().WithMany().HasForeignKey(item => item.MachineId).OnDelete(DeleteBehavior.Restrict);
        });
        modelBuilder.Entity<ImportBatch>(entity =>
        {
            entity.ToTable("import_batches"); entity.HasKey(item => item.Id);
            entity.Property(item => item.Id).HasColumnName("id"); entity.Property(item => item.ProjectId).HasColumnName("project_id"); entity.Property(item => item.SourceFileName).HasColumnName("source_file_name").HasMaxLength(260); entity.Property(item => item.Status).HasColumnName("status").HasMaxLength(32).HasConversion<string>(); entity.Property(item => item.CreatedBy).HasColumnName("created_by").HasMaxLength(160); entity.Property(item => item.Reason).HasColumnName("reason").HasMaxLength(500); entity.Property(item => item.CreatedAt).HasColumnName("created_at"); entity.HasIndex(item => new { item.ProjectId, item.CreatedAt }).HasDatabaseName("ix_import_batches_project_created_at"); entity.HasOne<Project>().WithMany().HasForeignKey(item => item.ProjectId).OnDelete(DeleteBehavior.Restrict);
        });
        modelBuilder.Entity<ImportRow>(entity =>
        {
            entity.ToTable("import_rows"); entity.HasKey(item => item.Id);
            entity.Property(item => item.Id).HasColumnName("id"); entity.Property(item => item.ImportBatchId).HasColumnName("import_batch_id"); entity.Property(item => item.RowNumber).HasColumnName("row_number"); entity.Property(item => item.Payload).HasColumnName("payload").HasColumnType("jsonb"); entity.Property(item => item.ValidationError).HasColumnName("validation_error").HasMaxLength(2000); entity.HasIndex(item => new { item.ImportBatchId, item.RowNumber }).IsUnique().HasDatabaseName("ux_import_rows_batch_row"); entity.HasOne<ImportBatch>().WithMany().HasForeignKey(item => item.ImportBatchId).OnDelete(DeleteBehavior.Restrict);
        });
        modelBuilder.Entity<VersionExposureSnapshot>(entity =>
        {
            entity.ToTable("version_exposure_snapshots"); entity.HasKey(item => item.Id);
            entity.Property(item => item.Id).HasColumnName("id"); entity.Property(item => item.ComponentVersionId).HasColumnName("component_version_id"); entity.Property(item => item.BlockedAt).HasColumnName("blocked_at"); entity.Property(item => item.BlockedBy).HasColumnName("blocked_by").HasMaxLength(160); entity.Property(item => item.Reason).HasColumnName("reason").HasMaxLength(500);
            entity.HasIndex(item => new { item.ComponentVersionId, item.BlockedAt }).HasDatabaseName("ix_version_exposure_snapshots_version_blocked_at"); entity.HasOne<ComponentVersion>().WithMany().HasForeignKey(item => item.ComponentVersionId).OnDelete(DeleteBehavior.Restrict);
        });
        modelBuilder.Entity<VersionExposureMachine>(entity =>
        {
            entity.ToTable("version_exposure_machines"); entity.HasKey(item => item.Id);
            entity.Property(item => item.Id).HasColumnName("id"); entity.Property(item => item.VersionExposureSnapshotId).HasColumnName("version_exposure_snapshot_id"); entity.Property(item => item.MachineId).HasColumnName("machine_id"); entity.Property(item => item.Role).HasColumnName("role").HasMaxLength(32).HasConversion<string>();
            entity.HasIndex(item => new { item.VersionExposureSnapshotId, item.MachineId, item.Role }).IsUnique().HasDatabaseName("ux_version_exposure_machines_snapshot_machine_role"); entity.HasOne<VersionExposureSnapshot>().WithMany().HasForeignKey(item => item.VersionExposureSnapshotId).OnDelete(DeleteBehavior.Restrict); entity.HasOne<Machine>().WithMany().HasForeignKey(item => item.MachineId).OnDelete(DeleteBehavior.Restrict);
        });
        modelBuilder.Entity<VersionExposureBaseline>(entity =>
        {
            entity.ToTable("version_exposure_baselines"); entity.HasKey(item => item.Id);
            entity.Property(item => item.Id).HasColumnName("id"); entity.Property(item => item.VersionExposureSnapshotId).HasColumnName("version_exposure_snapshot_id"); entity.Property(item => item.ConfigurationBaselineId).HasColumnName("configuration_baseline_id");
            entity.HasIndex(item => new { item.VersionExposureSnapshotId, item.ConfigurationBaselineId }).IsUnique().HasDatabaseName("ux_version_exposure_baselines_snapshot_baseline"); entity.HasOne<VersionExposureSnapshot>().WithMany().HasForeignKey(item => item.VersionExposureSnapshotId).OnDelete(DeleteBehavior.Restrict); entity.HasOne<ConfigurationBaseline>().WithMany().HasForeignKey(item => item.ConfigurationBaselineId).OnDelete(DeleteBehavior.Restrict);
        });
    }
}
