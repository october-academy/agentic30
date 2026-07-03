// Founder OS Kit — public surface.
// A faithful React mirror of the Agentic30 SwiftUI app: primitives, molecules,
// the reference-page renderer, and full screen compositions. Built from the app's
// OpenDesign* sources + verified against e2e app screenshots.

export type { Tone } from "./tokens";

/* ---- Primitives ---- */
export { Button, type ButtonProps, type ButtonVariant, type ButtonSize } from "./components/Button";
export { Badge, type BadgeProps } from "./components/Badge";
export { Chip, type ChipProps } from "./components/Chip";
export { Input, type InputProps } from "./components/Input";
export { Toggle, type ToggleProps } from "./components/Toggle";
export { Segmented, type SegmentedProps } from "./components/Segmented";
export { IconButton, type IconButtonProps } from "./components/IconButton";
export { Icon, type IconProps } from "./components/Icon";
export { Avatar, type AvatarProps } from "./components/Avatar";
export { SectionHeader, type SectionHeaderProps } from "./components/SectionHeader";
export { Spinner, type SpinnerProps } from "./components/Spinner";
export { ProgressBar, type ProgressBarProps } from "./components/ProgressBar";
export { ProgressRing, type ProgressRingProps } from "./components/ProgressRing";
export { Sparkline, type SparklineProps } from "./components/Sparkline";
export { SourcePill, type SourcePillProps } from "./components/SourcePill";
export { DashPagination, type DashPaginationProps } from "./components/DashPagination";

/* ---- Cards, rows & molecules ---- */
export { Card, type CardProps } from "./components/Card";
export { StatCard, type StatCardProps } from "./components/StatCard";
export { MetricPill, type MetricPillProps } from "./components/MetricPill";
export { ListRow, type ListRowProps } from "./components/ListRow";
export { KVRow, type KVRowProps } from "./components/KVRow";
export { OptionCard, type OptionCardProps } from "./components/OptionCard";
export { QuestionCard, type QuestionCardProps } from "./components/QuestionCard";
export { StateCard, type StateCardProps } from "./components/StateCard";
export { DebtBanner, type DebtBannerProps } from "./components/DebtBanner";
export { Stepper, type StepperProps, type StepperStep, type StepState } from "./components/Stepper";
export { ProviderCard, type ProviderCardProps } from "./components/ProviderCard";
export { ArticleCard, type ArticleCardProps } from "./components/ArticleCard";
export { TimelineRow, type TimelineRowProps } from "./components/TimelineRow";

/* ---- Reference-page renderer (the 6 dashboard screens share this) ---- */
export { Rail, type RailProps, type RailItem } from "./components/reference/Rail";
export { SideRow, type SideRowProps } from "./components/reference/SideRow";
export { ReferenceSidebar, type ReferenceSidebarProps, type SidebarGroup } from "./components/reference/ReferenceSidebar";
export { Titlebar, type TitlebarProps } from "./components/reference/Titlebar";
export { ReferenceHeader, type ReferenceHeaderProps } from "./components/reference/ReferenceHeader";
export { FilterTabs, type FilterTabsProps } from "./components/reference/FilterTabs";
export { RefSection, type RefSectionProps } from "./components/reference/RefSection";
export { MetaPanel, type MetaPanelProps } from "./components/reference/MetaPanel";
export { ReferenceShell, type ReferenceShellProps } from "./components/reference/ReferenceShell";
export { PhaseGateRow, type PhaseGateRowProps } from "./components/reference/PhaseGateRow";
export { DayCalendar, type DayCalendarProps, type CalendarPhase } from "./components/reference/DayCalendar";

/* ---- Screen compositions (the 6 reference-page dashboards) ---- */
export { ProjectsReferencePage, type ProjectsReferencePageProps } from "./components/reference/ProjectsReferencePage";
export { SettingsReferencePage, type SettingsReferencePageProps } from "./components/reference/SettingsReferencePage";
export { InterviewsReferencePage, type InterviewsReferencePageProps } from "./components/reference/InterviewsReferencePage";
export { BipLogReferencePage, type BipLogReferencePageProps } from "./components/reference/BipLogReferencePage";
export { NewsReferencePage, type NewsReferencePageProps } from "./components/reference/NewsReferencePage";
export { HistoryReferencePage, type HistoryReferencePageProps } from "./components/reference/HistoryReferencePage";
