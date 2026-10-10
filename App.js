import React, { useMemo, useRef, useState } from 'react';
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import HowItWorksPage from './pages/HowItWorksPage';
import MyListPage from './pages/MyListPage';
import PlanTripPage from './pages/PlanTripPage';
import { starterList } from './pages/pageData';

const colors = {
  cream: '#FFF9E8',
  olive: '#647426',
  gold: '#EABD79',
  red: '#C9573E',
  ink: '#3A3B25',
  pale: '#EBECCF',
  line: 'rgba(100, 116, 38, .23)',
  tan: '#E9E9CE',
};

const spacing = { xs: 6, sm: 10, md: 16, lg: 24, xl: 40, xxl: 64 };
const typography = {
  serif: 'Georgia',
  sans: 'System',
  scribble: 'cursive',
};

function BackgroundSvg({ type }) {
  if (type === 'header') {
    return (
      <Svg style={styles.backgroundSvg} viewBox="0 0 859 82" preserveAspectRatio="none">
        <Rect width="859" height="82" fill="#FFF9E5" />
        <Rect width="859" height="64" fill="#E8B97A" />
        <Path d="M0 62H859V82H0Z" fill="#E8B97A" />
        {Array.from({ length: 30 }, (_, index) => <Circle key={index} cx={2 + index * 28.5} cy="80" r="15" fill="#FFF9E5" />)}
      </Svg>
    );
  }
  if (type === 'striped') {
    return (
      <Svg style={styles.backgroundSvg} viewBox="0 0 466 577" preserveAspectRatio="none">
        <Rect width="466" height="577" fill="#E7E9D0" />
        {Array.from({ length: 12 }, (_, index) => (
          <React.Fragment key={index}>
            <Rect x={4 + index * 42} width="10" height="577" fill="#E8B97A" />
            <Rect x={26 + index * 42} width="4" height="577" fill="#F4F1DC" />
          </React.Fragment>
        ))}
      </Svg>
    );
  }
  const topAndBottomBubbles = Array.from({ length: 17 }, (_, index) => 26 + index * 36.45);
  const sideBubbles = Array.from({ length: 6 }, (_, index) => 26 + index * 38.34);
  return (
    <Svg style={styles.backgroundSvg} viewBox="0 0 635 320" preserveAspectRatio="xMidYMid slice">
      <Rect width="635" height="320" fill="#E7E9D0" />
      <Rect x="26" y="26" width="583" height="268" fill="#FFF9E5" />
      {topAndBottomBubbles.map((cx, index) => (
        <React.Fragment key={`horizontal-${index}`}>
          <Circle cx={cx} cy="26" r="21" fill="#FFF9E5" />
          <Circle cx={cx} cy="294" r="21" fill="#FFF9E5" />
        </React.Fragment>
      ))}
      {sideBubbles.map((cy, index) => (
        <React.Fragment key={`vertical-${index}`}>
          <Circle cx="26" cy={cy} r="21" fill="#FFF9E5" />
          <Circle cx="609" cy={cy} r="21" fill="#FFF9E5" />
        </React.Fragment>
      ))}
    </Svg>
  );
}

const trips = [
  { label: 'MARKET A', price: '$55', detail: 'Food $52 + fuel $3', stops: '1 stop · simple trip' },
  { label: 'TWO-STOP LOOP', price: '$48', detail: 'Food $43 + fuel $5', stops: '2 stops · save $7', featured: true },
  { label: 'MARKET B', price: '$56', detail: 'Food $47 + fuel $9', stops: '1 stop · simple trip' },
];

function SectionEyebrow({ children }) {
  return <Text style={styles.eyebrow}>{children}</Text>;
}

function ActionButton({ children, onPress, small = false }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={children}
      onPress={onPress}
      style={({ pressed }) => [styles.button, small && styles.buttonSmall, pressed && styles.buttonPressed]}
    >
      <Text style={styles.buttonText}>{children}</Text>
    </Pressable>
  );
}

function Header({ currentPage, onNavigate, scrollTo }) {
  const handlePress = (page) => {
    if (page === 'story') {
      if (currentPage === 'home') {
        scrollTo('story');
      } else {
        onNavigate('home', 'story');
      }
      return;
    }

    onNavigate(page);
  };

  return (
    <View style={styles.header}>
      <BackgroundSvg type="header" />
      <View style={styles.headerNav}>
        <Pressable accessibilityRole="link" accessibilityLabel="Plan a trip" onPress={() => handlePress('plan')}>
          <Text style={[styles.navText, currentPage === 'plan' && styles.navTextActive]}>PLAN A TRIP</Text>
        </Pressable>
        <Pressable accessibilityRole="link" accessibilityLabel="How it works" onPress={() => handlePress('how')}>
          <Text style={[styles.navText, currentPage === 'how' && styles.navTextActive]}>HOW IT WORKS</Text>
        </Pressable>
        <Pressable accessibilityRole="link" accessibilityLabel="Our story" onPress={() => handlePress('story')}>
          <Text style={[styles.navText, currentPage === 'home' && styles.navTextActive]}>OUR STORY</Text>
        </Pressable>
        <Pressable accessibilityRole="link" accessibilityLabel="My list" onPress={() => handlePress('list')}>
          <Text style={[styles.navText, currentPage === 'list' && styles.navTextActive]}>MY LIST ↗</Text>
        </Pressable>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel="Home" onPress={() => handlePress('home')} style={styles.brandTouchable}>
        <View style={styles.brand}>
          <Image source={require('./assets/board-6.png')} accessibilityLabel="Stretch" style={styles.brandImage} />
        </View>
      </Pressable>
    </View>
  );
}

function RouteIllustration() {
  const { width } = useWindowDimensions();
  const isWide = width >= 640;

  return (
    <View accessibilityLabel="Illustration of a two-stop grocery route" style={[styles.routePanel, isWide && styles.wideRoutePanel]}>
      <Image
        source={require('./assets/example-map.png')}
        accessibilityLabel="Example map showing a route from home to Market A to Market B and back home"
        style={styles.routeImage}
      />
    </View>
  );
}

function RouteStop({ label, value, gold = false, style }) {
  return (
    <View style={[styles.routeStop, style]}>
      <View style={[styles.stopCircle, gold && styles.goldStop]}>
        <Text style={[styles.stopValue, gold && styles.goldStopValue]}>{value}</Text>
      </View>
      <Text style={styles.stopLabel}>{label}</Text>
    </View>
  );
}

function Hero({ onNavigate }) {
  const { width } = useWindowDimensions();
  const isWide = width >= 640;

  return (
    <View style={[styles.hero, isWide && styles.wideHero]}>
      <View style={styles.heroCopy}>
        <SectionEyebrow>MADE FOR EVERYDAY ATLANTA ADVENTURES</SectionEyebrow>
        <Text accessibilityRole="header" style={styles.heroTitle}>The little trip{'\n'}that stretches{'\n'}your budget.</Text>
        <Text style={styles.intro}>Your list, a smarter route, and more left over.{'\n'}Compare the groceries and the drive home.</Text>
        <ActionButton onPress={() => onNavigate('plan')}>PLOT MY TRIP ↗</ActionButton>
      </View>
      <RouteIllustration />
    </View>
  );
}

function TripCard({ trip }) {
  return (
    <View style={[styles.tripCard, trip.featured && styles.featuredTrip]}>
      <Text style={[styles.tripLabel, trip.featured && styles.featuredTripText]}>{trip.label}</Text>
      <Text style={[styles.tripPrice, trip.featured && styles.featuredTripText]}>{trip.price}</Text>
      <Text style={[styles.tripDetail, trip.featured && styles.featuredTripText]}>{trip.detail}</Text>
      <Text style={[styles.tripStops, trip.featured && styles.featuredTripText]}>{trip.stops}</Text>
    </View>
  );
}

function Comparison({ onNavigate }) {
  return (
    <View nativeID="planner" style={styles.comparison}>
      <View style={styles.comparisonCard}>
        <SectionEyebrow>SAME LIST. DIFFERENT TRIPS.</SectionEyebrow>
        <Text accessibilityRole="header" style={styles.sectionTitle}>Find your sweet spot.</Text>
        <View style={styles.tripOptions}>{trips.map((trip) => <TripCard key={trip.label} trip={trip} />)}</View>
        <Text style={styles.caption}>Illustrative sample totals · food plus round-trip fuel</Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Build my list"
        onPress={() => onNavigate('list')}
        style={styles.listBanner}
      >
        <Text style={styles.bannerText}>YOUR NEXT GOOD TRIP STARTS WITH A LIST.</Text>
        <Text style={styles.bannerText}>BUILD MY LIST ↗</Text>
      </Pressable>
    </View>
  );
}

function Budget({ onNavigate }) {
  const { width } = useWindowDimensions();
  const isWide = width >= 640;
  const [activeStep, setActiveStep] = useState(0);
  const steps = [
    ['01', 'MAKE A LIST'],
    ['02', 'COMPARE TRIPS'],
    ['03', 'BRING IT HOME'],
  ];

  return (
    <View nativeID="budget" style={[styles.budget, isWide && styles.wideBudget]}>
      <View nativeID="how" style={[styles.budgetCopy, isWide && styles.wideBudgetCopy]}>
        <SectionEyebrow>FOOD + FUEL + A PLAN</SectionEyebrow>
        <Text accessibilityRole="header" style={styles.sectionTitle}>Your budget called.{'\n'}Go a little further.</Text>
        <Text style={styles.budgetIntro}>Make the whole trip work for you. Choose one stop, try a swap, or take the scenic savings.</Text>
        <View style={styles.steps}>
          {steps.map(([number, label], index) => (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: activeStep === index }}
              accessibilityLabel={label}
              key={number}
              onPress={() => setActiveStep(index)}
              style={[styles.step, index === activeStep && styles.activeStep, index === 2 && styles.lastStep]}
            >
              <Text style={styles.stepNumber}>{number}</Text>
              <Text style={styles.stepLabel}>{label}</Text>
            </Pressable>
          ))}
        </View>
        <ActionButton small onPress={() => onNavigate('plan')}>TRY STRETCH ↗</ActionButton>
      </View>
      <View style={[styles.receiptScene, isWide && styles.wideReceiptScene]}>
        <BackgroundSvg type="striped" />
        <View style={styles.receipt}>
          <SectionEyebrow>THE WHOLE TRIP</SectionEyebrow>
          <Text style={styles.receiptTotal}>$48</Text>
          <View style={styles.receiptRow}><Text style={styles.receiptText}>Groceries</Text><Text style={styles.receiptText}>$43</Text></View>
          <View style={styles.receiptRow}><Text style={styles.receiptText}>Fuel</Text><Text style={styles.receiptText}>$5</Text></View>
          <Text style={styles.receiptText}>Home → A → B → Home</Text>
        </View>
        <Text style={styles.receiptNote}>More dinner.{'\n'}Less detour doubt.</Text>
      </View>
    </View>
  );
}

function Cta({ onNavigate }) {
  return (
    <View nativeID="story" style={styles.cta}>
      <View style={styles.ctaCard}>
        <SectionEyebrow>SMALL CHANGES. FULLER BASKETS.</SectionEyebrow>
        <Text accessibilityRole="header" style={styles.sectionTitle}>Bring more home.</Text>
        <Text style={styles.ctaText}>Start with your list. Leave with a plan.</Text>
        <ActionButton onPress={() => onNavigate('plan')}>PLAN MY FIRST TRIP ↗</ActionButton>
      </View>
    </View>
  );
}

export default function App() {
  const scrollRef = useRef(null);
  const { width } = useWindowDimensions();
  const isWide = width >= 640;
  const [currentPage, setCurrentPage] = useState('home');
  const [selectedTrip, setSelectedTrip] = useState('TWO-STOP LOOP');
  const [groceryList, setGroceryList] = useState(starterList);

  const sectionOffsets = useMemo(() => ({ planner: isWide ? 360 : 470, budget: isWide ? 650 : 930, how: isWide ? 650 : 930, story: isWide ? 1030 : 1430 }), [isWide]);
  const scrollTo = (section) => scrollRef.current?.scrollTo({ y: sectionOffsets[section], animated: true });

  const handleNavigate = (page, section) => {
    setCurrentPage(page);
    if (page === 'home' && section) {
      setTimeout(() => scrollTo(section), 0);
    }
  };

  const handleAddItem = (label, qty) => {
    setGroceryList((currentList) => [{ id: Date.now(), label, qty, checked: false }, ...currentList]);
  };

  const handleToggleItem = (id) => {
    setGroceryList((currentList) => currentList.map((item) => (item.id === id ? { ...item, checked: !item.checked } : item)));
  };

  const handleRemoveItem = (id) => {
    setGroceryList((currentList) => currentList.filter((item) => item.id !== id));
  };

  if (currentPage === 'home') {
    return (
      <ScrollView ref={scrollRef} style={styles.screen} contentContainerStyle={styles.content}>
        <Header currentPage={currentPage} onNavigate={handleNavigate} scrollTo={scrollTo} />
        <Hero onNavigate={handleNavigate} />
        <Comparison onNavigate={handleNavigate} />
        <Budget onNavigate={handleNavigate} />
        <Cta onNavigate={handleNavigate} />
        <View style={styles.footer}>
          <BackgroundSvg type="bubbly" />
          <Text style={styles.footerText}>STRETCH · HACKLANTA 2026 · SAMPLE DATA</Text>
        </View>
      </ScrollView>
    );
  }

  return (
    <View style={styles.screen}>
      <Header currentPage={currentPage} onNavigate={handleNavigate} scrollTo={scrollTo} />
      <ScrollView contentContainerStyle={styles.pagesContent}>
        {currentPage === 'plan' && <PlanTripPage selectedTrip={selectedTrip} onSelectTrip={setSelectedTrip} />}
        {currentPage === 'how' && <HowItWorksPage />}
        {currentPage === 'list' && (
          <MyListPage groceryList={groceryList} onToggleItem={handleToggleItem} onRemoveItem={handleRemoveItem} onAddItem={handleAddItem} />
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.cream },
  content: { backgroundColor: colors.cream },
  pagesContent: { backgroundColor: colors.cream, paddingBottom: spacing.xxl },
  header: { height: 82, backgroundColor: colors.gold, position: 'relative', justifyContent: 'center', paddingHorizontal: '5%' },
  headerNav: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  navText: { color: colors.olive, fontFamily: typography.sans, fontSize: 9, fontWeight: '700' },
  navTextActive: { opacity: 0.65 },
  brandTouchable: { position: 'absolute', top: 0, left: '50%', marginLeft: -47 },
  brand: { width: 94, height: 64, backgroundColor: colors.cream, alignItems: 'center', justifyContent: 'center' },
  brandImage: { width: 86, height: 55, resizeMode: 'contain' },
  hero: { minHeight: 430, paddingHorizontal: '9%', paddingVertical: spacing.xl, backgroundColor: colors.cream, flexDirection: 'column' },
  wideHero: { minHeight: 360, flexDirection: 'row' },
  heroCopy: { flex: 1 },
  eyebrow: { color: colors.olive, fontFamily: typography.sans, fontSize: 8, fontWeight: '700', letterSpacing: 0.4, marginBottom: spacing.md },
  heroTitle: { color: colors.olive, fontFamily: typography.serif, fontSize: 39, lineHeight: 36 },
  intro: { color: colors.ink, fontFamily: typography.sans, fontSize: 11, lineHeight: 15, marginTop: spacing.xl, marginBottom: spacing.md },
  button: { alignSelf: 'flex-start', backgroundColor: colors.red, paddingVertical: 11, paddingHorizontal: 16, minHeight: 32, justifyContent: 'center' },
  buttonSmall: { marginTop: spacing.lg },
  buttonPressed: { opacity: 0.75 },
  buttonText: { color: colors.cream, fontFamily: typography.sans, fontSize: 8, fontWeight: '700' },
  routePanel: { height: 290, position: 'relative', marginTop: spacing.lg, padding: spacing.sm, backgroundColor: colors.tan, borderRadius: 20 },
  wideRoutePanel: { flex: 1, height: 'auto', minHeight: 360, marginTop: 0 },
  routeImage: { width: '100%', height: '100%', resizeMode: 'contain' },
  scribble: { color: colors.olive, fontFamily: typography.scribble, fontSize: 18, lineHeight: 19, position: 'absolute', right: '7%', top: 0, transform: [{ rotate: '-4deg' }] },
  routeMap: { position: 'absolute', left: 0, right: 0, top: 30, bottom: 0 },
  routeStop: { position: 'absolute', alignItems: 'center' },
  homeStop: { left: '2%', bottom: 11 },
  marketAStop: { left: '36%', top: 42 },
  marketBStop: { right: '3%', top: 123 },
  stopCircle: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.olive, alignItems: 'center', justifyContent: 'center' },
  goldStop: { backgroundColor: colors.gold },
  stopValue: { color: colors.cream, fontFamily: typography.sans, fontSize: 15, fontWeight: '700' },
  goldStopValue: { color: colors.olive },
  stopLabel: { color: colors.olive, fontFamily: typography.sans, fontSize: 7, fontWeight: '700', marginTop: 3 },
  comparison: { backgroundColor: colors.olive, paddingHorizontal: '5%', paddingVertical: spacing.xl },
  comparisonCard: { backgroundColor: colors.cream, paddingHorizontal: '6%', paddingTop: 34, paddingBottom: 18, alignItems: 'center' },
  sectionTitle: { color: colors.olive, fontFamily: typography.serif, fontSize: 28, lineHeight: 29, marginBottom: spacing.lg },
  tripOptions: { width: '100%', flexDirection: 'row', borderWidth: 1, borderColor: '#A6AA73' },
  tripCard: { flex: 1, minHeight: 102, padding: spacing.md, borderRightWidth: 1, borderRightColor: '#A6AA73' },
  featuredTrip: { backgroundColor: colors.olive },
  tripLabel: { color: colors.olive, fontFamily: typography.sans, fontSize: 7 },
  tripPrice: { color: colors.olive, fontFamily: typography.serif, fontSize: 24, marginVertical: 8 },
  tripDetail: { color: colors.olive, fontFamily: typography.sans, fontSize: 7 },
  tripStops: { color: colors.olive, fontFamily: typography.sans, fontSize: 7, marginTop: 'auto' },
  featuredTripText: { color: colors.cream },
  caption: { color: colors.olive, fontFamily: typography.sans, fontSize: 7, marginTop: spacing.md },
  listBanner: { marginTop: spacing.lg, borderRadius: 8, backgroundColor: colors.gold, paddingVertical: 12, paddingHorizontal: spacing.lg, flexDirection: 'row', justifyContent: 'space-between' },
  bannerText: { color: colors.olive, fontFamily: typography.sans, fontSize: 7, fontWeight: '700' },
  budget: { backgroundColor: colors.cream, flexDirection: 'column' },
  wideBudget: { minHeight: 383, flexDirection: 'row' },
  budgetCopy: { paddingHorizontal: '9%', paddingVertical: spacing.xxl },
  wideBudgetCopy: { flex: 1, paddingLeft: '12%' },
  budgetIntro: { color: colors.ink, fontFamily: typography.sans, fontSize: 11, lineHeight: 15, marginTop: spacing.xl, marginBottom: spacing.lg },
  steps: { flexDirection: 'row', gap: spacing.sm },
  step: { width: 67, height: 59, backgroundColor: colors.gold, borderRadius: 10, padding: spacing.sm },
  activeStep: { backgroundColor: colors.olive },
  lastStep: { backgroundColor: colors.red },
  stepNumber: { color: colors.cream, fontFamily: typography.serif, fontSize: 19 },
  stepLabel: { color: colors.cream, fontFamily: typography.sans, fontSize: 6, marginTop: 6 },
  receiptScene: { minHeight: 350, overflow: 'hidden', backgroundColor: '#e7e9d0', paddingHorizontal: '14%', paddingTop: spacing.xxl, borderLeftWidth: 8, borderLeftColor: colors.gold, borderRightWidth: 8, borderRightColor: colors.gold },
  wideReceiptScene: { flex: 1, minHeight: 383 },
  receipt: { backgroundColor: colors.cream, padding: spacing.xl, transform: [{ rotate: '5deg' }], minHeight: 210 },
  receiptTotal: { color: colors.olive, fontFamily: typography.serif, fontSize: 52, lineHeight: 55, marginVertical: spacing.md },
  receiptRow: { flexDirection: 'row', justifyContent: 'space-between' },
  receiptText: { color: colors.olive, fontFamily: typography.sans, fontSize: 10, lineHeight: 16 },
  receiptNote: { color: colors.olive, fontFamily: typography.scribble, fontSize: 21, lineHeight: 20, marginLeft: '12%', marginTop: spacing.md, transform: [{ rotate: '-5deg' }] },
  cta: { backgroundColor: colors.pale, paddingHorizontal: '10%', paddingVertical: spacing.xl },
  ctaCard: { backgroundColor: colors.cream, borderRadius: 22, padding: spacing.xl, alignItems: 'center' },
  ctaText: { color: colors.olive, fontFamily: typography.sans, fontSize: 11, marginTop: -spacing.sm, marginBottom: spacing.md },
  footer: { minHeight: 82, backgroundColor: colors.pale, alignItems: 'center', justifyContent: 'center', paddingVertical: spacing.lg, position: 'relative', overflow: 'hidden' },
  backgroundSvg: { ...StyleSheet.absoluteFillObject, width: '100%', height: '100%' },
  footerText: { color: colors.olive, fontFamily: typography.sans, fontSize: 7 },
});
