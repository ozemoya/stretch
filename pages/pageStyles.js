import { StyleSheet } from 'react-native';

const colors = {
  cream: '#FFF9E8',
  olive: '#647426',
  gold: '#EABD79',
  red: '#C9573E',
  ink: '#3A3B25',
  pale: '#EBECCF',
};

const typography = {
  serif: 'Georgia',
  sans: 'System',
};

const spacing = { sm: 10, md: 16, lg: 24, xl: 40, xxl: 64 };

export default StyleSheet.create({
  pageShell: { paddingHorizontal: '8%', paddingVertical: spacing.xl, backgroundColor: colors.cream },
  pageTitle: { color: colors.olive, fontFamily: typography.serif, fontSize: 34, lineHeight: 36, marginBottom: spacing.lg },
  eyebrow: { color: colors.olive, fontFamily: typography.sans, fontSize: 8, fontWeight: '700', letterSpacing: 0.4, marginBottom: spacing.md },
  tripPageGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', marginTop: spacing.lg },
  tripOptionCard: { width: '31%', minHeight: 160, backgroundColor: colors.pale, borderRadius: 16, padding: spacing.md, marginBottom: spacing.md, borderWidth: 1, borderColor: '#C6CBB1' },
  tripOptionFeatured: { backgroundColor: colors.olive },
  tripOptionSelected: { borderColor: colors.red, borderWidth: 2 },
  tripCardLabel: { color: colors.olive, fontFamily: typography.sans, fontSize: 8, fontWeight: '700' },
  tripCardPrice: { color: colors.olive, fontFamily: typography.serif, fontSize: 30, marginVertical: 8 },
  tripCardDetail: { color: colors.olive, fontFamily: typography.sans, fontSize: 8, lineHeight: 12 },
  tripCardStops: { color: colors.olive, fontFamily: typography.sans, fontSize: 8, marginTop: spacing.sm },
  featuredTripText: { color: colors.cream },
  planSummaryCard: { backgroundColor: colors.gold, borderRadius: 18, padding: spacing.lg, marginTop: spacing.lg },
  planSummaryTitle: { color: colors.olive, fontFamily: typography.sans, fontSize: 8, fontWeight: '700', letterSpacing: 0.5 },
  planSummaryValue: { color: colors.olive, fontFamily: typography.serif, fontSize: 28, marginTop: spacing.sm, marginBottom: spacing.sm },
  planSummaryText: { color: colors.olive, fontFamily: typography.sans, fontSize: 10, lineHeight: 15 },
  stepsGrid: { marginTop: spacing.lg },
  howStep: { backgroundColor: colors.pale, borderRadius: 16, padding: spacing.lg, marginBottom: spacing.md },
  howStepActive: { backgroundColor: colors.olive },
  howStepNumber: { color: colors.olive, fontFamily: typography.serif, fontSize: 24, marginBottom: spacing.sm },
  howStepNumberActive: { color: colors.cream },
  howStepTitle: { color: colors.olive, fontFamily: typography.sans, fontSize: 12, fontWeight: '700', letterSpacing: 0.8 },
  howStepTitleActive: { color: colors.cream },
  howStepDescription: { color: colors.ink, fontFamily: typography.sans, fontSize: 10, lineHeight: 16, marginTop: spacing.sm },
  listInputCard: { backgroundColor: colors.pale, borderRadius: 14, padding: spacing.md, marginTop: spacing.lg, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  input: { flex: 1, minWidth: 180, backgroundColor: colors.cream, borderRadius: 10, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, color: colors.olive, fontFamily: typography.sans, fontSize: 12 },
  inputSmall: { flex: 0.3, marginLeft: spacing.sm },
  addButton: { backgroundColor: colors.red, borderRadius: 10, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, marginLeft: spacing.sm },
  addButtonText: { color: colors.cream, fontFamily: typography.sans, fontSize: 9, fontWeight: '700' },
  groceryList: { marginTop: spacing.lg },
  groceryItem: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.cream, borderRadius: 12, padding: spacing.md, marginBottom: spacing.sm, borderWidth: 1, borderColor: '#D9DCC1' },
  checkBox: { width: 24, height: 24, borderRadius: 6, borderWidth: 1, borderColor: colors.olive, alignItems: 'center', justifyContent: 'center', marginRight: spacing.sm },
  checkBoxText: { color: colors.olive, fontFamily: typography.sans, fontSize: 16, fontWeight: '700' },
  itemTextWrap: { flex: 1 },
  itemLabel: { color: colors.olive, fontFamily: typography.sans, fontSize: 12, fontWeight: '700' },
  itemChecked: { textDecorationLine: 'line-through', opacity: 0.6 },
  itemQty: { color: colors.olive, fontFamily: typography.sans, fontSize: 9, marginTop: 2 },
  removeButton: { paddingHorizontal: spacing.sm, paddingVertical: 6 },
  removeButtonText: { color: colors.red, fontFamily: typography.sans, fontSize: 8, fontWeight: '700' },
});
