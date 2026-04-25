/**
 * Root route — auth-aware. Logged-out users see the marketing landing
 * page; logged-in users see the dashboard (HomePageClient with their
 * projects). Mirrors apps/web's home.tsx clientLoader pattern.
 */
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import HomePageClient from "@clash/web-ui/components/HomePageClient";
import { useSession } from "../lib/use-session";

import Background from "../landing/Background";
import LandingNav from "../landing/LandingNav";
import LandingHero from "../landing/LandingHero";
import FeatureGrid from "../landing/FeatureGrid";
import HowItWorks from "../landing/HowItWorks";
import UseCases from "../landing/UseCases";
import Pricing from "../landing/Pricing";
import CTASection from "../landing/CTASection";
import BlogPreview from "../landing/BlogPreview";
import LandingFooter from "../landing/LandingFooter";

export const Route = createFileRoute("/")({
  component: IndexPage,
});

function IndexPage() {
  const { data: session, isPending } = useSession();
  const authed = !!session?.user?.id;

  const projectsQ = useQuery({
    queryKey: ["projects"],
    queryFn: async () => {
      const res = await fetch("/api/projects", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load projects");
      return (await res.json()) as unknown[];
    },
    enabled: typeof window !== "undefined" && authed,
  });

  if (isPending || !authed) {
    return <Landing />;
  }

  return <HomePageClient initialProjects={(projectsQ.data ?? []) as any} />;
}

function Landing() {
  return (
    <div className="relative">
      <Background />
      <LandingNav />
      <LandingHero />
      <FeatureGrid />
      <HowItWorks />
      <UseCases />
      <Pricing />
      <CTASection />
      <BlogPreview />
      <LandingFooter />
    </div>
  );
}
