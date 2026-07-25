import Background from "@clash/web-ui/components/Background";
import LandingNav from "@clash/web-ui/components/landing/LandingNav";
import LandingHero from "@clash/web-ui/components/landing/LandingHero";
import FeatureGrid from "@clash/web-ui/components/landing/FeatureGrid";
import HowItWorks from "@clash/web-ui/components/landing/HowItWorks";
import UseCases from "@clash/web-ui/components/landing/UseCases";
import CTASection from "@clash/web-ui/components/landing/CTASection";
import LandingFooter from "@clash/web-ui/components/landing/LandingFooter";

export default function LandingRoute() {
  return (
    <div className="clash-landing-page relative overflow-x-hidden">
      <Background />
      <LandingNav />
      <LandingHero />
      <FeatureGrid />
      <HowItWorks />
      <UseCases />
      <CTASection />
      <LandingFooter />
    </div>
  );
}
