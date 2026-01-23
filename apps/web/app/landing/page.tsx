import LandingNav from '../components/landing/LandingNav';
import LandingHero from '../components/landing/LandingHero';
import FeatureGrid from '../components/landing/FeatureGrid';
import LandingFooter from '../components/landing/LandingFooter';
import Background from '../components/Background';

export default function LandingPage() {
  return (
    <div className="relative min-h-screen">
      <Background />
      <LandingNav />
      <main>
        <LandingHero />
        <FeatureGrid />
      </main>
      <LandingFooter />
    </div>
  );
}
