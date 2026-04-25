import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import HomePageClient from "@clash/web-ui/components/HomePageClient";
import LayoutContent from "@clash/web-ui/components/LayoutContent";
import LandingNav from "@clash/web-ui/components/landing/LandingNav";
import LandingHero from "@clash/web-ui/components/landing/LandingHero";
import FeatureGrid from "@clash/web-ui/components/landing/FeatureGrid";
import HowItWorks from "@clash/web-ui/components/landing/HowItWorks";
import UseCases from "@clash/web-ui/components/landing/UseCases";
import Pricing from "@clash/web-ui/components/landing/Pricing";
import CTASection from "@clash/web-ui/components/landing/CTASection";
import BlogPreview from "@clash/web-ui/components/landing/BlogPreview";
import LandingFooter from "@clash/web-ui/components/landing/LandingFooter";
import { authClient } from "../lib/auth-client";

export const Route = createFileRoute("/")({
  component: IndexPage,
});

function IndexPage() {
  const session = authClient.useSession();
  const isPending = session.isPending;
  const authed = !!session.data?.user?.id;

  const projectsQ = useQuery({
    queryKey: ["projects"],
    queryFn: async () => {
      const res = await fetch("/api/projects", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load projects");
      return (await res.json()) as unknown[];
    },
    enabled: typeof window !== "undefined" && authed,
  });

  return (
    <LayoutContent isAuthenticated={authed}>
      {isPending || !authed ? (
        <Landing />
      ) : (
        <HomePageClient initialProjects={(projectsQ.data ?? []) as any} />
      )}
    </LayoutContent>
  );
}

function Landing() {
  return (
    <>
      <LandingNav />
      <LandingHero />
      <FeatureGrid />
      <HowItWorks />
      <UseCases />
      <Pricing />
      <CTASection />
      <BlogPreview />
      <LandingFooter />
    </>
  );
}
