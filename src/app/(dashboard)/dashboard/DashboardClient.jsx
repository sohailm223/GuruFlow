'use client';



import StatsCards from "@/app/components/dashboard/StatsCards";
import RevenueCard from "@/app/components/dashboard/RevenueCard";
import RevenueBreakdown from "@/app/components/dashboard/RevenueBreakdown";
import ProjectTable from "@/app/components/dashboard/ProjectTable";
import TeamSummary from "@/app/components/dashboard/TeamSummary";
import DeadlineAlert from "@/app/components/dashboard/DeadlineAlert";
import SetPageTitle from "@/app/components/common/SetPageTitle";

export default function DashboardClient({ projects, stats, team }) {

  return (
    <div className="space-y-6">
              <SetPageTitle title="Dashboard Overview" />

      <StatsCards stats={stats} />
      <RevenueCard amount={stats.revenue} />
      <RevenueBreakdown projects={projects} />
      <DeadlineAlert projects={projects} />
      <ProjectTable projects={projects} />
      <TeamSummary title="Team Members" members={team} />
    </div>
  );
}
