using ConfigHub.Infrastructure.Persistence;
using ConfigHub.Infrastructure.Persistence.Entities;
using Microsoft.EntityFrameworkCore;

namespace ConfigHub.Host.Catalog;

public static partial class CatalogEndpoints
{
    private static async Task<IResult> ListMachineRegistryAsync(Guid projectId, IDbContextFactory<ConfigHubDbContext> factory, CancellationToken cancellationToken)
    {
        await using var database = await factory.CreateDbContextAsync(cancellationToken);
        if (!await database.Projects.AsNoTracking().AnyAsync(project => project.Id == projectId && project.Status == ProjectStatus.Active, cancellationToken))
            return Results.NotFound();

        var machines = await database.Machines.AsNoTracking().Where(machine => machine.ProjectId == projectId)
            .OrderBy(machine => machine.Location).ThenBy(machine => machine.Name)
            .Select(machine => new
            {
                machine.Id, machine.ProjectId, machine.Name, machine.SerialNumber, machine.MachineType,
                machine.Location, machine.Owner, machine.Stage, machine.ExpectedResumeAt,
                status = machine.Status.ToString(),
                targetBaselineId = database.MachineTargetAssignments.Where(target => target.MachineId == machine.Id && target.ValidTo == null)
                    .Select(target => (Guid?)target.ConfigurationBaselineId).SingleOrDefault(),
                targetBaselineCode = (from target in database.MachineTargetAssignments
                    join baseline in database.ConfigurationBaselines on target.ConfigurationBaselineId equals baseline.Id
                    where target.MachineId == machine.Id && target.ValidTo == null
                    select baseline.BaselineCode).SingleOrDefault(),
                matchStatus = database.MachineDriftSummaries.Where(summary => summary.MachineId == machine.Id).Select(summary => (string?)summary.MatchStatus.ToString()).SingleOrDefault(),
                riskSeverity = database.MachineDriftSummaries.Where(summary => summary.MachineId == machine.Id).Select(summary => (string?)summary.RiskSeverity.ToString()).SingleOrDefault(),
                summaryCalculatedAt = database.MachineDriftSummaries.Where(summary => summary.MachineId == machine.Id).Select(summary => (DateTimeOffset?)summary.CalculatedAt).SingleOrDefault(),
                hasActualConfiguration = database.MachineCurrentConfigurations.Any(state => state.MachineId == machine.Id)
            }).ToListAsync(cancellationToken);

        // Batch reads keep registry cost independent of the number of machines and never infer actual versions from a target.
        var actual = await (from state in database.MachineCurrentConfigurations.AsNoTracking()
            join machine in database.Machines on state.MachineId equals machine.Id
            join component in database.ConfigurationComponents on state.ConfigurationComponentId equals component.Id
            join version in database.ComponentVersions on state.ComponentVersionId equals version.Id
            where machine.ProjectId == projectId && state.State == CurrentConfigurationState.Present
            orderby component.SortOrder, component.Name
            select new { state.MachineId, componentId = component.Id, componentName = component.Name, versionId = version.Id, versionNumber = version.VersionNumber })
            .ToListAsync(cancellationToken);
        var chambers = await (from chamber in database.MachineChambers.AsNoTracking()
            join machine in database.Machines on chamber.MachineId equals machine.Id
            where machine.ProjectId == projectId && chamber.Installed
            orderby chamber.Number
            select new { chamber.MachineId, chamber.Number }).ToListAsync(cancellationToken);
        var actualByMachine = actual.ToLookup(item => item.MachineId);
        var chambersByMachine = chambers.ToLookup(item => item.MachineId);

        return Results.Ok(new
        {
            items = machines.Select(machine => new
            {
                machine.Id, machine.ProjectId, machine.Name, machine.SerialNumber, machine.MachineType,
                machine.Location, machine.Owner, machine.Stage, machine.ExpectedResumeAt, machine.status,
                machine.targetBaselineId, machine.targetBaselineCode,
                matchStatus = machine.matchStatus ?? "Unknown", riskSeverity = machine.riskSeverity ?? "Unknown",
                machine.summaryCalculatedAt, machine.hasActualConfiguration,
                chambers = chambersByMachine[machine.Id].Select(chamber => chamber.Number),
                actualVersions = actualByMachine[machine.Id].Select(item => new { item.componentId, item.componentName, item.versionId, item.versionNumber })
            }),
            targetBaselines = machines.Where(machine => machine.targetBaselineId is not null)
                .Select(machine => new { id = machine.targetBaselineId!.Value, code = machine.targetBaselineCode! }).Distinct().OrderBy(baseline => baseline.code),
            actualVersions = actual.Select(item => new { item.componentId, item.componentName, item.versionId, item.versionNumber })
                .Distinct().OrderBy(item => item.componentName).ThenBy(item => item.versionNumber)
        });
    }
}
