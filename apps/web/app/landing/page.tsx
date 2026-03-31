import LandingNav from '../components/landing/LandingNav';
import LandingHero from '../components/landing/LandingHero';
import HowItWorks from '../components/landing/HowItWorks';
import UseCases from '../components/landing/UseCases';
import FeatureGrid from '../components/landing/FeatureGrid';
import Pricing from '../components/landing/Pricing';
import BlogPreview from '../components/landing/BlogPreview';
import CTASection from '../components/landing/CTASection';
import LandingFooter from '../components/landing/LandingFooter';
import Background from '../components/Background';

export default function LandingPage() {
  return (
    <div className="relative min-h-screen">
      <Background />
      <LandingNav />
      <main>
        <LandingHero />
        <HowItWorks />
        <UseCases />
        <FeatureGrid />
        <Pricing />
        <BlogPreview />
        <CTASection />
      </main>
      <LandingFooter />
    </div>
  );
}
