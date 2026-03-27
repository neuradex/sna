import * as react_jsx_runtime from 'react/jsx-runtime';
import { SkillEvent } from '../../hooks/use-skill-events.js';

interface SkillExecutionCardProps {
    skillName: string;
    events: SkillEvent[];
}
declare function SkillExecutionCard({ skillName, events }: SkillExecutionCardProps): react_jsx_runtime.JSX.Element;

export { SkillExecutionCard };
