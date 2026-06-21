/** Hold the registry of AI generated games.  Eventually this would be stored in a database in production. */
const aiGames: Record<string, string> = {
    'ai-rps': 'Simple Rock, Paper, Scissors game played with 2 players over 3 rounds.',
    'ai-rpsls': 'Rock, Paper, Scissors, Lizard, Spock game played with 2 players over 3 rounds.',
    'rps-deck-builder': 'Deck building game based on Rock, Paper, Scissors.',
};

export const getAiGameDescription = (moduleName: string): string => {
    return aiGames[moduleName];
}