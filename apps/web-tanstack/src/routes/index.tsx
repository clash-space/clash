import { useEffect } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
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

/**
 * Landing — ported verbatim from apps/web (OSS) with imports retargeted at
 * @tanstack/react-router and our local auth-client. If the user is already
 * signed in we send them to /billing (canonical authed home for now);
 * otherwise the marketing shell renders.
 */
export const Route = createFileRoute("/")({
  component: LandingPage,
});

function LandingPage() {
  const navigate = useNavigate();
  const { data: session } = useSession();

  useEffect(() => {
    if (session?.user?.id) {
      void navigate({ to: "/billing" });
    }
  }, [session, navigate]);

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
