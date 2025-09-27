import React from 'react';
import clsx from 'clsx';
import { GitBranchPlus } from 'lucide-react';
import { Link } from 'react-router';

export function Header({
	className,
	children,
}: React.ComponentProps<'header'>) {
	return (
		<header
			className={clsx(
				'h-13 shrink-0 w-full px-4 border-b flex items-center',
				className,
			)}
		>
			<h1 className="flex items-center gap-2 mx-4">
				<Link to="/" className="flex items-center gap-2">
					<GitBranchPlus className="h-6 w-6 text-primary" />
					<span className="text-lg font-semibold">Octpus</span>
				</Link>
			</h1>
			<div className="flex-1"></div>
			<div className="flex items-center gap-4">
				{children}
			</div>
		</header>
	);
}
