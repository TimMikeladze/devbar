"use client";

import { useState } from "react";

const INGREDIENTS = [
	{ name: "ripe tomatoes", amount: 400, unit: "g" },
	{ name: "onion", amount: 0.5, unit: "" },
	{ name: "garlic cloves", amount: 1, unit: "" },
	{ name: "olive oil", amount: 1, unit: "tbsp" },
	{ name: "vegetable stock", amount: 300, unit: "ml" },
];

const STEPS = [
	"Soften the chopped onion and garlic in the oil for five minutes.",
	"Add the tomatoes and stock, then simmer for twenty minutes.",
	"Blend until smooth and season with salt.",
];

export default function Home() {
	const [servings, setServings] = useState(2);

	return (
		<main style={{ maxWidth: 560, margin: "64px auto", padding: "0 16px", lineHeight: 1.6 }}>
			<h1 style={{ marginBottom: 4 }}>Tomato soup</h1>
			<p style={{ marginTop: 0 }}>Press the book button on the bar to open this page's spec.</p>

			<label>
				Servings{" "}
				<input
					type="number"
					min={1}
					max={12}
					value={servings}
					onChange={(event) => setServings(Math.max(1, Number(event.target.value)))}
					style={{ width: 56 }}
				/>
			</label>

			<h2>Ingredients</h2>
			<ul>
				{INGREDIENTS.map((item) => (
					<li key={item.name}>
						{(item.amount * servings) / 2} {item.unit} {item.name}
					</li>
				))}
			</ul>

			<h2>Method</h2>
			<ol>
				{STEPS.map((step) => (
					<li key={step}>{step}</li>
				))}
			</ol>
		</main>
	);
}
