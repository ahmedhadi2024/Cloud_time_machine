import { Handle, Position } from 'reactflow';
import { ICONS, Bar } from '../components/common.jsx';

/**
 * One service box on the canvas. `data.state` carries simulation results so
 * the same node renders normally, saturated (traffic), or failed (failure
 * simulation) without a second node type.
 */
export default function ServiceNode({ data, selected }) {
  const classes = ['service-node'];
  if (data.legacy) classes.push('legacy');
  if (selected) classes.push('selected');
  if (data.state === 'saturated') classes.push('saturated');
  if (data.state === 'failed') classes.push('failed');
  if (data.isNew) classes.push('new');

  return (
    <div className={classes.join(' ')} title={data.description}>
      <Handle type="target" position={Position.Left} />
      <div className="head">
        <span className="icon" aria-hidden="true">{ICONS[data.icon] ?? '▫'}</span>
        <span className="label">{data.label}</span>
      </div>
      {data.meta ? <div className="meta">{data.meta}</div> : null}
      {typeof data.utilisation === 'number' ? (
        <div className="util">
          <Bar
            value={data.utilisation}
            tone={data.utilisation >= 100 ? 'bad' : data.utilisation >= 80 ? 'warn' : 'ok'}
          />
        </div>
      ) : null}
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
