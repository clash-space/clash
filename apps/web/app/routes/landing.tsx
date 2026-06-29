import Background from "@clash/web-ui/components/Background";
import LandingNav from "@clash/web-ui/components/landing/LandingNav";
import LandingHero from "@clash/web-ui/components/landing/LandingHero";
import FeatureGrid from "@clash/web-ui/components/landing/FeatureGrid";
import HowItWorks from "@clash/web-ui/components/landing/HowItWorks";
import UseCases from "@clash/web-ui/components/landing/UseCases";
import Pricing from "@clash/web-ui/components/landing/Pricing";
import CTASection from "@clash/web-ui/components/landing/CTASection";
import BlogPreview from "@clash/web-ui/components/landing/BlogPreview";
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
      <Pricing />
      <CTASection />
      <BlogPreview />
      <LandingFooter />
    </div>
  );
}
