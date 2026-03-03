const Sentiment = require('sentiment');
const sentiment = new Sentiment();

const emotionKeywords = {
  happy: ['love', 'amazing', 'awesome', 'great', 'excellent', 'fantastic', 'wonderful', 'best', 'perfect', 'happy', 'thank', 'thanks', 'appreciate', 'enjoy', 'loved', 'brilliant', 'superb', 'outstanding'],
  frustrated: ['frustrated', 'annoying', 'annoyed', 'angry', 'hate', 'worst', 'terrible', 'horrible', 'awful', 'useless', 'waste', 'ridiculous', 'unacceptable', 'disappointed', 'frustrating', 'irritating', 'pathetic'],
  confused: ['confused', 'confusing', 'unclear', 'understand', "don't get", 'complicated', 'difficult', 'hard to', 'not sure', 'lost', 'makes no sense', 'why', 'how do', 'help', 'stuck', 'issue'],
  satisfied: ['satisfied', 'good', 'nice', 'helpful', 'useful', 'works', 'working', 'fine', 'decent', 'solid', 'reliable', 'smooth', 'easy', 'simple', 'convenient'],
  disappointed: ['disappointed', 'disappointing', 'expected', 'better', 'could be', 'needs', 'lacking', 'missing', 'wish', 'hoped', 'letdown', 'underwhelming', 'mediocre']
};

function analyzeReview(text, score) {
  if (!text || text.trim() === '') {
    return {
      sentiment: score >= 4 ? 'positive' : score <= 2 ? 'negative' : 'neutral',
      sentimentScore: 0,
      emotions: []
    };
  }

  const result = sentiment.analyze(text);
  const normalizedScore = result.comparative;

  let sentimentLabel;
  if (normalizedScore > 0.1 || score >= 4) {
    sentimentLabel = 'positive';
  } else if (normalizedScore < -0.1 || score <= 2) {
    sentimentLabel = 'negative';
  } else {
    sentimentLabel = 'neutral';
  }

  if (score <= 2 && sentimentLabel === 'positive') {
    sentimentLabel = 'negative';
  } else if (score >= 4 && sentimentLabel === 'negative') {
    sentimentLabel = 'neutral';
  }

  const textLower = text.toLowerCase();
  const detectedEmotions = [];

  for (const [emotion, keywords] of Object.entries(emotionKeywords)) {
    const matchCount = keywords.filter(keyword => textLower.includes(keyword)).length;
    if (matchCount >= 1) {
      detectedEmotions.push({
        emotion,
        strength: matchCount >= 3 ? 'strong' : matchCount >= 2 ? 'moderate' : 'mild'
      });
    }
  }

  if (detectedEmotions.length === 0) {
    if (sentimentLabel === 'positive') {
      detectedEmotions.push({ emotion: 'satisfied', strength: 'mild' });
    } else if (sentimentLabel === 'negative') {
      detectedEmotions.push({ emotion: 'disappointed', strength: 'mild' });
    }
  }

  detectedEmotions.sort((a, b) => {
    const strengthOrder = { strong: 0, moderate: 1, mild: 2 };
    return strengthOrder[a.strength] - strengthOrder[b.strength];
  });

  return {
    sentiment: sentimentLabel,
    sentimentScore: normalizedScore,
    emotions: detectedEmotions.slice(0, 3)
  };
}

function analyzeBatch(reviews) {
  return reviews.map(review => ({
    ...review,
    ...analyzeReview(review.text, review.score)
  }));
}

module.exports = { analyzeReview, analyzeBatch };
